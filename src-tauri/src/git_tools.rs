use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct GitLocks(Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>);
impl GitLocks {
    pub fn repository(&self, path: &Path) -> Result<Arc<Mutex<()>>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .entry(path.to_path_buf())
            .or_default()
            .clone())
    }
}
struct ResultOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    ok: bool,
}
fn output(root: &Path, args: &[&str]) -> Result<ResultOutput, String> {
    output_input(root, args, None)
}
fn output_input(
    root: &Path,
    args: &[&str],
    input: Option<Vec<u8>>,
) -> Result<ResultOutput, String> {
    let mut command = Command::new("git");
    command
        .arg("--no-pager")
        .arg("-c")
        .arg("color.ui=false")
        .arg("-c")
        .arg("core.quotepath=false")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start Git; install Git and check PATH")?;
    if let Some(input) = input {
        let mut stdin = child.stdin.take().ok_or("Git input unavailable")?;
        std::thread::spawn(move || {
            let _ = stdin.write_all(&input);
        });
    }
    let stdout = child.stdout.take().ok_or("Git stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Git stderr unavailable")?;
    let collect = |reader: Box<dyn Read + Send>| {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut data = Vec::new();
            let result = reader
                .take(4 * 1024 * 1024 + 1)
                .read_to_end(&mut data)
                .map(|_| data);
            let _ = tx.send(result);
        });
        rx
    };
    let out = collect(Box::new(stdout));
    let err = collect(Box::new(stderr));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > Duration::from_secs(90) {
            #[cfg(unix)]
            {
                let _ = Command::new("/bin/kill")
                    .args(["-TERM", &format!("-{}", child.id())])
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err("Git timed out. Refresh and verify the result before retrying.".into());
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let read = |receiver: mpsc::Receiver<std::io::Result<Vec<u8>>>| -> Result<Vec<u8>, String> {
        let bytes = receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "Git output did not close; inspect the repository before retrying")?
            .map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("Git output exceeds 4 MB; narrow the selection or use the terminal".into());
        }
        Ok(bytes)
    };
    Ok(ResultOutput {
        stdout: read(out)?,
        stderr: read(err)?,
        ok: status.success(),
    })
}
fn run(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let result = output(root, args)?;
    if result.ok {
        Ok(result.stdout)
    } else {
        Err(String::from_utf8_lossy(&result.stderr)
            .trim()
            .chars()
            .take(2000)
            .collect::<String>())
    }
}
fn string(root: &Path, args: &[&str]) -> Result<String, String> {
    String::from_utf8(run(root, args)?)
        .map_err(|_| "This repository contains non-UTF-8 names or content".into())
}
pub fn root(project_root: &Path) -> Result<PathBuf, String> {
    let root = PathBuf::from(string(project_root, &["rev-parse", "--show-toplevel"])?.trim());
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if root != project_root {
        return Err("Select the repository root as a project folder to use Git actions".into());
    }
    Ok(root)
}

pub fn search_paths(path: &Path) -> Result<Option<std::collections::HashSet<PathBuf>>, String> {
    let top = match string(path, &["rev-parse", "--show-toplevel"]) {
        Ok(top) => PathBuf::from(top.trim()),
        Err(_) => return Ok(None),
    };
    let output = run(
        path,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "--full-name",
            "-z",
        ],
    )?;
    let mut paths = std::collections::HashSet::new();
    for name in output
        .split(|byte| *byte == 0)
        .filter(|name| !name.is_empty())
    {
        let name =
            std::str::from_utf8(name).map_err(|_| "Non-UTF-8 filenames cannot be searched")?;
        let file = top.join(name);
        if file.starts_with(path) {
            paths.insert(file.clone());
            let mut parent = file.parent();
            while let Some(directory) = parent {
                if !directory.starts_with(path) {
                    break;
                }
                paths.insert(directory.to_path_buf());
                parent = directory.parent();
            }
        }
    }
    Ok(Some(paths))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub original_path: Option<String>,
    pub index: String,
    pub worktree: String,
    pub conflict: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub branch: String,
    pub head: String,
    pub entries: Vec<Entry>,
    pub branches: Vec<String>,
    pub remotes: Vec<String>,
    pub staged_revision: String,
    pub merging: bool,
    pub history: Vec<Commit>,
    pub stashes: Vec<Stash>,
    pub reverting: bool,
}
#[derive(Serialize)]
pub struct Stash {
    pub reference: String,
    pub hash: String,
    pub subject: String,
}
fn stashes(root: &Path) -> Result<Vec<Stash>, String> {
    let text = string(root, &["stash", "list", "--format=%gd%x00%H%x00%gs"])?;
    Ok(text
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\0');
            Some(Stash {
                reference: parts.next()?.into(),
                hash: parts.next()?.into(),
                subject: parts.next()?.into(),
            })
        })
        .collect())
}
#[derive(Serialize)]
pub struct Commit {
    hash: String,
    subject: String,
    author: String,
    date: String,
}
pub fn current_branch(root: &Path) -> Result<String, String> {
    let branch = output(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    if branch.ok {
        return Ok(String::from_utf8_lossy(&branch.stdout).trim().into());
    }
    let head = output(root, &["rev-parse", "--short", "HEAD"])?;
    if head.ok {
        Ok(format!(
            "detached {}",
            String::from_utf8_lossy(&head.stdout).trim()
        ))
    } else {
        Ok(String::new())
    }
}

pub fn snapshot(root: &Path) -> Result<Snapshot, String> {
    let status = run(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let entries = parse_status(&status)?;
    let branch = string(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .unwrap_or_else(|_| "Detached HEAD".into())
        .trim()
        .into();
    let head = string(root, &["rev-parse", "--verify", "HEAD"])
        .unwrap_or_default()
        .trim()
        .into();
    let branches = string(
        root,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
    )?
    .lines()
    .map(String::from)
    .collect();
    let remotes = string(root, &["remote"])?
        .lines()
        .map(String::from)
        .collect();
    let staged_revision = string(
        root,
        &[
            "diff",
            "--cached",
            "--raw",
            "--full-index",
            "--no-abbrev",
            "--no-renames",
        ],
    )?;
    let merging = output(root, &["rev-parse", "--verify", "MERGE_HEAD"])?.ok;
    let history = string(root, &["log", "-30", "--format=%H%x00%s%x00%an%x00%aI"])
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let fields = line.split('\0').collect::<Vec<_>>();
            (fields.len() == 4).then(|| Commit {
                hash: fields[0].into(),
                subject: fields[1].into(),
                author: fields[2].into(),
                date: fields[3].into(),
            })
        })
        .collect();
    Ok(Snapshot {
        stashes: stashes(root)?,
        reverting: output(root, &["rev-parse", "--verify", "REVERT_HEAD"])?.ok,
        branch,
        head,
        entries,
        branches,
        remotes,
        staged_revision,
        merging,
        history,
    })
}
fn parse_status(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "Non-UTF-8 Git paths are not supported in the panel")?;
    let mut records = text.split('\0').filter(|s| !s.is_empty());
    let mut entries = Vec::new();
    while let Some(record) = records.next() {
        if record.len() < 4 || !record.is_char_boundary(3) {
            return Err("Unexpected Git status output".into());
        }
        let status = &record[..2];
        let original_path = if status.contains(['R', 'C']) {
            Some(
                records
                    .next()
                    .ok_or("Incomplete Git rename record")?
                    .to_string(),
            )
        } else {
            None
        };
        entries.push(Entry {
            path: record[3..].into(),
            original_path,
            index: record[..1].into(),
            worktree: record[1..2].into(),
            conflict: status.contains('U') || ["AA", "DD"].contains(&status),
        });
    }
    Ok(entries)
}
fn path_argument(path: &str) -> Result<(), String> {
    if path.is_empty()
        || Path::new(path)
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
        || path
            .split(['/', '\\'])
            .any(|p| p.eq_ignore_ascii_case(".git"))
    {
        return Err("Choose a file within this repository".into());
    }
    Ok(())
}
pub fn diff(root: &Path, path: &str, staged: bool) -> Result<String, String> {
    path_argument(path)?;
    if snapshot(root)?
        .entries
        .iter()
        .any(|e| e.path == path && e.index == "?")
    {
        let target = crate::file_core::authorize_path(
            &[root.to_string_lossy().into_owned()],
            &root.join(path).to_string_lossy(),
        )?;
        if std::fs::symlink_metadata(root.join(path))
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Review symlink changes in the terminal".into());
        }
        return crate::file_core::read(&target).map(|text| format!("New file: {path}\n\n{text}"));
    }
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    string(root, &args)
}

#[derive(Serialize)]
pub struct Hunks {
    pub patch: String,
    pub header: String,
    pub hunks: Vec<String>,
    pub supported: bool,
}
pub fn hunks(root: &Path, path: &str, staged: bool) -> Result<Hunks, String> {
    path_argument(path)?;
    let state = snapshot(root)?;
    let entry = state
        .entries
        .iter()
        .find(|entry| entry.path == path)
        .ok_or("This file is no longer changed")?;
    let patch = diff(root, path, staged)?;
    let supported = !entry.conflict
        && entry.original_path.is_none()
        && entry.index != "?"
        && !patch.contains("GIT binary patch")
        && !patch.contains("Binary files ")
        && !patch.contains("new file mode")
        && !patch.contains("deleted file mode")
        && !patch.contains("old mode");
    let (header, hunks) = split_hunks(&patch);
    Ok(Hunks {
        patch,
        header,
        hunks,
        supported,
    })
}
fn split_hunks(patch: &str) -> (String, Vec<String>) {
    let mut header = String::new();
    let mut hunks = Vec::<String>::new();
    for line in patch.split_inclusive('\n') {
        if line.starts_with("@@ ") {
            hunks.push(String::new());
        }
        if let Some(hunk) = hunks.last_mut() {
            hunk.push_str(line);
        } else {
            header.push_str(line);
        }
    }
    (header, hunks)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkRequest {
    pub path: String,
    pub staged: bool,
    pub reviewed_patch: String,
    pub selected: Vec<usize>,
    pub expected_head: String,
    pub expected_staged: String,
}
pub fn apply_hunks(root: &Path, request: HunkRequest) -> Result<(), String> {
    let before = snapshot(root)?;
    if before.head != request.expected_head || before.staged_revision != request.expected_staged {
        return Err("HEAD or the index changed. Refresh and review the diff again.".into());
    }
    let current = hunks(root, &request.path, request.staged)?;
    if !current.supported || current.patch != request.reviewed_patch {
        return Err(
            "The diff changed or this file requires whole-file staging. Review it again.".into(),
        );
    }
    let selected = request
        .selected
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    if selected.is_empty()
        || selected.len() > 100
        || selected.iter().any(|index| *index >= current.hunks.len())
    {
        return Err("Choose valid hunks to apply".into());
    }
    let mut patch = current.header;
    for index in selected {
        patch.push_str(&current.hunks[index]);
    }
    let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
    if request.staged {
        args.push("--reverse");
    }
    let mut check = args.clone();
    check.push("--check");
    let checked = output_input(root, &check, Some(patch.as_bytes().to_vec()))?;
    if !checked.ok {
        return Err("Selected hunks no longer apply cleanly. Refresh and review again.".into());
    }
    let applied = output_input(root, &args, Some(patch.into_bytes()))?;
    if !applied.ok {
        return Err(String::from_utf8_lossy(&applied.stderr).trim().into());
    }
    Ok(())
}
pub fn show_commit(root: &Path, hash: &str) -> Result<String, String> {
    if !(40..=64).contains(&hash.len()) || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Choose a full commit hash from history".into());
    }
    string(
        root,
        &[
            "show",
            "--format=fuller",
            "--stat",
            "--patch",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            hash,
            "--",
        ],
    )
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub action: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub remote: String,
    #[serde(default)]
    pub expected_head: String,
    #[serde(default)]
    pub expected_staged: String,
    #[serde(default)]
    pub reviewed_diff: Option<String>,
    #[serde(default)]
    pub paths: Vec<String>,
}
fn branch_name(root: &Path, value: &str) -> Result<(), String> {
    if value.starts_with('-') || value.is_empty() {
        return Err("Enter a branch name".into());
    }
    run(root, &["check-ref-format", "--branch", value])?;
    Ok(())
}
pub fn action(root: &Path, request: Action) -> Result<String, String> {
    let before = snapshot(root)?;
    if before.head != request.expected_head {
        return Err("HEAD changed. Refresh Git and review before retrying.".into());
    }
    if request.action == "stage" {
        if let Some(reviewed) = &request.reviewed_diff {
            if &diff(root, &request.path, false)? != reviewed {
                return Err("This file changed since the diff was opened. Review its updated diff before staging.".into());
            }
        }
    }
    let result = match request.action.as_str() {
        "stage-many" | "unstage-many" => {
            if before.staged_revision != request.expected_staged {
                return Err("The index changed. Refresh Git before selecting files again.".into());
            }
            if request.paths.is_empty() {
                return Err("Choose files to stage or unstage".into());
            }
            let staging = request.action == "stage-many";
            let entries: HashMap<_, _> = before
                .entries
                .iter()
                .map(|entry| (entry.path.as_str(), entry))
                .collect();
            let mut paths = std::collections::BTreeSet::new();
            for path in &request.paths {
                path_argument(path)?;
                if path.contains('\0') {
                    return Err("Invalid file path".into());
                }
                let entry = entries
                    .get(path.as_str())
                    .ok_or("A selected file is no longer changed. Refresh Git and retry.")?;
                if entry.conflict {
                    return Err("Resolve and validate conflicts before staging files".into());
                }
                if (staging && entry.worktree == " " && entry.index != "?")
                    || (!staging && (entry.index == " " || entry.index == "?"))
                {
                    return Err("The selected files changed. Refresh Git and retry.".into());
                }
                paths.insert(path.as_str());
                if let Some(original) = entry
                    .original_path
                    .as_deref()
                    .filter(|_| !staging || entry.worktree == "R")
                {
                    path_argument(original)?;
                    paths.insert(original);
                }
            }
            let input = paths
                .iter()
                .flat_map(|path| path.bytes().chain(std::iter::once(0)))
                .collect();
            let args = if staging {
                vec!["add", "--pathspec-from-file=-", "--pathspec-file-nul"]
            } else if before.head.is_empty() {
                vec![
                    "rm",
                    "--cached",
                    "--pathspec-from-file=-",
                    "--pathspec-file-nul",
                ]
            } else {
                vec![
                    "restore",
                    "--staged",
                    "--pathspec-from-file=-",
                    "--pathspec-file-nul",
                ]
            };
            let result = output_input(root, &args, Some(input))?;
            if !result.ok {
                return Err(String::from_utf8_lossy(&result.stderr)
                    .chars()
                    .take(2000)
                    .collect());
            }
            result.stdout
        }
        "rollback" => {
            if before.staged_revision != request.expected_staged {
                return Err("The index changed. Review the file before rolling it back.".into());
            }
            path_argument(&request.path)?;
            let entry = before
                .entries
                .iter()
                .find(|entry| entry.path == request.path)
                .ok_or("This file is no longer changed")?;
            if entry.conflict
                || entry.index == "?"
                || entry.worktree == " "
                || entry.worktree == "R"
            {
                return Err(
                    "Choose a tracked, unstaged file without merge conflicts or a worktree rename"
                        .into(),
                );
            }
            let reviewed = request
                .reviewed_diff
                .as_ref()
                .ok_or("Review the file before rolling it back")?;
            if &diff(root, &request.path, false)? != reviewed {
                return Err(
                    "This file changed since rollback was requested. Review it again.".into(),
                );
            }
            run(root, &["restore", "--worktree", "--", &request.path])?
        }
        "stage" => {
            path_argument(&request.path)?;
            let entry = before
                .entries
                .iter()
                .find(|e| e.path == request.path)
                .ok_or("This path is no longer changed")?;
            if entry.conflict {
                return Err(
                    "Resolve and validate conflict markers before staging this file".into(),
                );
            }
            let mut args = vec!["add", "--", request.path.as_str()];
            if let Some(original) = &entry
                .original_path
                .as_ref()
                .filter(|_| entry.worktree == "R")
            {
                path_argument(original)?;
                args.push(original);
            }
            run(root, &args)?
        }
        "resolve" => {
            path_argument(&request.path)?;
            if !before
                .entries
                .iter()
                .any(|e| e.path == request.path && e.conflict)
            {
                return Err("This file is not conflicted".into());
            }
            let text = crate::file_core::read(&root.join(&request.path))?;
            if text.lines().any(|line| {
                ["<<<<<<<", "=======", ">>>>>>>", "|||||||"]
                    .iter()
                    .any(|marker| line.starts_with(marker))
            }) {
                return Err("Conflict markers remain in the file".into());
            }
            run(root, &["add", "--", &request.path])?
        }
        "unstage" => {
            path_argument(&request.path)?;
            if before.head.is_empty() {
                run(root, &["rm", "--cached", "--", &request.path])?
            } else {
                let mut args = vec!["restore", "--staged", "--", request.path.as_str()];
                if let Some(original) = before
                    .entries
                    .iter()
                    .find(|entry| entry.path == request.path)
                    .and_then(|entry| entry.original_path.as_deref())
                {
                    path_argument(original)?;
                    args.push(original);
                }
                run(root, &args)?
            }
        }
        "commit" => {
            if before.staged_revision != request.expected_staged {
                return Err(
                    "The index changed. Review the staged changes before committing.".into(),
                );
            }
            if before.entries.iter().any(|e| e.conflict) {
                return Err("Resolve all conflicts before committing".into());
            }
            if request.value.trim().is_empty() || request.value.len() > 16000 {
                return Err("Enter a commit message (up to 16 KB)".into());
            }
            if before.staged_revision.is_empty() && !before.merging {
                return Err("Stage changes before committing".into());
            }
            run(root, &["commit", "-m", &request.value])?
        }
        "switch" | "create-branch" | "merge" => {
            if before.merging
                || before.reverting
                || (request.action != "switch" && !before.entries.is_empty())
            {
                return Err(
                    "Commit or explicitly stash local changes before switching or merging branches"
                        .into(),
                );
            }
            branch_name(root, &request.value)?;
            match request.action.as_str() {
                "switch" => {
                    if !before.branches.contains(&request.value) {
                        return Err("Choose a local branch".into());
                    }
                    run(root, &["switch", "--", &request.value])?
                }
                "create-branch" => run(root, &["switch", "-c", &request.value])?,
                _ => {
                    if !before.branches.contains(&request.value) {
                        return Err("Choose a local branch to merge".into());
                    }
                    let result = output(
                        root,
                        &["merge", "--no-ff", "--no-commit", "--", &request.value],
                    )?;
                    if !result.ok && !snapshot(root)?.merging {
                        return Err(String::from_utf8_lossy(&result.stderr).into());
                    }
                    result.stdout
                }
            }
        }
        "fetch" | "pull" | "push" => {
            if !before.remotes.contains(&request.remote) {
                return Err("Choose a configured remote".into());
            }
            if request.action == "pull"
                && (!before.entries.is_empty() || before.merging || before.reverting)
            {
                return Err("Commit or stash local changes before pulling".into());
            }
            if before.branch == "Detached HEAD" && request.action != "fetch" {
                return Err("Switch to a branch first".into());
            }
            match request.action.as_str() {
                "fetch" => run(root, &["fetch", "--", &request.remote])?,
                "pull" => run(
                    root,
                    &["pull", "--ff-only", "--", &request.remote, &before.branch],
                )?,
                _ => run(
                    root,
                    &[
                        "push",
                        "--set-upstream",
                        "--",
                        &request.remote,
                        &before.branch,
                    ],
                )?,
            }
        }
        "abort-merge" => {
            if !before.merging {
                return Err("No merge is in progress".into());
            }
            if before.staged_revision != request.expected_staged {
                return Err("The index changed. Review the current merge before aborting.".into());
            }
            run(root, &["merge", "--abort"])?
        }
        "stash" => {
            if before.merging || before.reverting || before.entries.iter().any(|e| e.conflict) {
                return Err("Finish the merge before stashing".into());
            }
            run(
                root,
                &[
                    "stash",
                    "push",
                    "--include-untracked",
                    "-m",
                    "Octode explicit stash",
                ],
            )?
        }
        "rename-branch" | "delete-branch" => {
            if before.merging || before.reverting {
                return Err("Finish the merge/revert before changing branches".into());
            }
            if !before.branches.contains(&request.path) {
                return Err("Choose an existing local branch".into());
            }
            branch_name(root, &request.path)?;
            if request.action == "rename-branch" {
                branch_name(root, &request.value)?;
                run(root, &["branch", "-m", "--", &request.path, &request.value])?
            } else {
                if request.path == before.branch {
                    return Err("Switch away from this branch before deleting it".into());
                }
                run(root, &["branch", "-d", "--", &request.path])?
            }
        }
        "revert" => {
            if !before.entries.is_empty() || before.merging || before.reverting {
                return Err("Start with a clean working tree before reverting a commit".into());
            }
            if !(40..=64).contains(&request.value.len())
                || !request.value.chars().all(|c| c.is_ascii_hexdigit())
            {
                return Err("Choose a full commit hash from history".into());
            }
            let parents = string(root, &["rev-list", "--parents", "-n", "1", &request.value])?;
            if parents.split_whitespace().count() > 2 {
                return Err("Reverting a merge commit requires choosing a mainline parent; use the terminal for this case".into());
            }
            let result = output(root, &["revert", "--no-commit", &request.value])?;
            if !result.ok && !snapshot(root)?.entries.iter().any(|entry| entry.conflict) {
                return Err(String::from_utf8_lossy(&result.stderr).into());
            }
            b"Revert applied without committing. Review the changes and commit when ready.".to_vec()
        }
        "abort-revert" => {
            if !before.reverting {
                return Err("No revert is in progress".into());
            }
            if before.staged_revision != request.expected_staged {
                return Err("The index changed; review before aborting".into());
            }
            run(root, &["revert", "--abort"])?
        }
        "stash-apply" | "stash-drop" => {
            if before.merging || before.reverting {
                return Err("Finish the merge/revert first".into());
            }
            let stash = if request.path.is_empty() && request.action == "stash-apply" {
                before.stashes.first()
            } else {
                before
                    .stashes
                    .iter()
                    .find(|stash| stash.reference == request.path && stash.hash == request.value)
            }
            .ok_or("This stash changed or disappeared; refresh and select it again")?;
            if request.action == "stash-apply" {
                if !before.entries.is_empty() {
                    return Err("Start with a clean working tree before applying a stash".into());
                }
                run(root, &["stash", "apply", &stash.hash])?
            } else {
                run(root, &["stash", "drop", &stash.reference])?
            }
        }
        _ => return Err("Unsupported Git action".into()),
    };
    Ok(String::from_utf8_lossy(&result)
        .chars()
        .take(3000)
        .collect())
}
#[derive(Serialize)]
pub struct Conflict {
    pub base: String,
    pub ours: String,
    pub theirs: String,
    pub current: String,
}
pub fn conflict(root: &Path, path: &str) -> Result<Conflict, String> {
    path_argument(path)?;
    if !snapshot(root)?
        .entries
        .iter()
        .any(|e| e.path == path && e.conflict)
    {
        return Err("Choose a conflicted file".into());
    }
    let stage = |n| {
        String::from_utf8(run(root, &["show", &format!(":{n}:{path}")])?)
            .map_err(|_| "Binary conflicts must be resolved outside the text editor".to_string())
    };
    Ok(Conflict {
        base: stage(1)?,
        ours: stage(2)?,
        theirs: stage(3)?,
        current: crate::file_core::read(&root.join(path))?,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Repo(PathBuf);
    impl Repo {
        fn new() -> Self {
            let path = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
            std::fs::create_dir(&path).unwrap();
            run(&path, &["init", "-b", "main"]).unwrap();
            run(&path, &["config", "user.name", "Octode Test"]).unwrap();
            run(&path, &["config", "user.email", "test@example.invalid"]).unwrap();
            Self(path.canonicalize().unwrap())
        }
    }
    impl Drop for Repo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn act(repo: &Path, kind: &str, path: &str, value: &str) -> Result<String, String> {
        let before = snapshot(repo)?;
        action(
            repo,
            Action {
                action: kind.into(),
                path: path.into(),
                value: value.into(),
                remote: String::new(),
                expected_head: before.head,
                expected_staged: before.staged_revision,
                paths: Vec::new(),
                reviewed_diff: None,
            },
        )
    }
    #[test]
    fn batches_literal_paths_and_unstages_without_changing_worktree() {
        let repo = Repo::new();
        let names = [
            "first.php",
            "second file.php",
            ":(glob)*.php",
            "line\nbreak.php",
        ];
        let batch = |kind: &str, names: &[&str]| {
            let before = snapshot(&repo.0).unwrap();
            let request = serde_json::from_value(serde_json::json!({
                "action": kind, "paths": names,
                "expectedHead": before.head, "expectedStaged": before.staged_revision,
            }))
            .unwrap();
            action(&repo.0, request)
        };
        for name in names {
            std::fs::write(repo.0.join(name), "original\n").unwrap();
        }
        // Validate the entire batch before touching the index.
        assert!(batch("stage-many", &[names[0], "../outside"]).is_err());
        assert!(snapshot(&repo.0).unwrap().staged_revision.is_empty());
        batch("stage-many", &names).unwrap();
        assert!(snapshot(&repo.0)
            .unwrap()
            .entries
            .iter()
            .all(|entry| entry.index == "A"));
        // Unstage also works before the repository has its first commit.
        batch("unstage-many", &names).unwrap();
        assert!(snapshot(&repo.0).unwrap().staged_revision.is_empty());
        batch("stage-many", &names).unwrap();
        act(&repo.0, "commit", "", "initial").unwrap();
        std::fs::remove_file(repo.0.join(names[0])).unwrap();
        std::fs::write(repo.0.join(names[1]), "edited\n").unwrap();
        batch("stage-many", &names[..2]).unwrap();
        batch("unstage-many", &names[..2]).unwrap();
        assert!(!repo.0.join(names[0]).exists());
        assert_eq!(
            std::fs::read_to_string(repo.0.join(names[1])).unwrap(),
            "edited\n"
        );
        assert!(snapshot(&repo.0).unwrap().staged_revision.is_empty());
    }
    #[test]
    fn batch_unstage_includes_rename_source_and_rejects_stale_index() {
        let repo = Repo::new();
        std::fs::write(repo.0.join("old"), "original\n").unwrap();
        act(&repo.0, "stage", "old", "").unwrap();
        act(&repo.0, "commit", "", "initial").unwrap();
        run(&repo.0, &["mv", "old", "renamed"]).unwrap();
        let before = snapshot(&repo.0).unwrap();
        let request = || {
            serde_json::from_value(serde_json::json!({
                "action": "unstage-many", "paths": ["renamed"],
                "expectedHead": before.head, "expectedStaged": before.staged_revision,
            }))
            .unwrap()
        };
        std::fs::write(repo.0.join("other"), "other\n").unwrap();
        act(&repo.0, "stage", "other", "").unwrap();
        assert!(action(&repo.0, request())
            .unwrap_err()
            .contains("index changed"));
        act(&repo.0, "unstage", "other", "").unwrap();
        action(&repo.0, request()).unwrap();
        assert!(snapshot(&repo.0).unwrap().staged_revision.is_empty());
        assert!(repo.0.join("renamed").exists());
        assert!(!repo.0.join("old").exists());
    }
    #[test]
    fn reads_branch_names_without_a_worktree_status_scan() {
        let repo = Repo::new();
        assert_eq!(current_branch(&repo.0).unwrap(), "main");
        std::fs::write(repo.0.join("one.txt"), "one").unwrap();
        run(&repo.0, &["add", "."]).unwrap();
        run(&repo.0, &["commit", "-m", "one"]).unwrap();
        run(&repo.0, &["checkout", "--detach"]).unwrap();
        assert!(current_branch(&repo.0).unwrap().starts_with("detached "));
        // A directory outside any Git worktree has no branch label.
        assert_eq!(current_branch(&std::env::temp_dir()).unwrap(), "");
    }
    #[test]
    fn handles_unusual_paths_staging_commits_branches_and_unstaging() {
        let repo = Repo::new();
        let name = "odd space →.php";
        std::fs::write(repo.0.join(name), "one\n").unwrap();
        assert_eq!(snapshot(&repo.0).unwrap().entries[0].path, name);
        act(&repo.0, "stage", name, "").unwrap();
        assert!(!snapshot(&repo.0).unwrap().staged_revision.is_empty());
        act(&repo.0, "unstage", name, "").unwrap();
        assert!(snapshot(&repo.0).unwrap().staged_revision.is_empty());
        act(&repo.0, "stage", name, "").unwrap();
        act(&repo.0, "commit", "", "First").unwrap();
        act(&repo.0, "create-branch", "", "feature").unwrap();
        std::fs::write(repo.0.join(name), "two\n").unwrap();
        // Git carries local changes when both branches have the same file.
        act(&repo.0, "switch", "", "main").unwrap();
        assert_eq!(snapshot(&repo.0).unwrap().branch, "main");
        assert!(diff(&repo.0, name, false).unwrap().contains("+two"));
        act(&repo.0, "stage", name, "").unwrap();
        act(&repo.0, "unstage", name, "").unwrap();
        assert_eq!(std::fs::read_to_string(repo.0.join(name)).unwrap(), "two\n");
    }
    #[test]
    fn branch_switch_preserves_local_work_and_refuses_overwrites() {
        let repo = Repo::new();
        let file = repo.0.join("shared.php");
        std::fs::write(&file, "base\n").unwrap();
        act(&repo.0, "stage", "shared.php", "").unwrap();
        act(&repo.0, "commit", "", "Base").unwrap();
        act(&repo.0, "create-branch", "", "feature").unwrap();
        std::fs::write(&file, "feature\n").unwrap();
        act(&repo.0, "stage", "shared.php", "").unwrap();
        act(&repo.0, "commit", "", "Feature").unwrap();
        act(&repo.0, "switch", "", "main").unwrap();
        std::fs::write(repo.0.join("untracked.txt"), "keep me\n").unwrap();
        act(&repo.0, "switch", "", "feature").unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("untracked.txt")).unwrap(),
            "keep me\n"
        );
        std::fs::write(&file, "unsaved work\n").unwrap();
        assert!(act(&repo.0, "switch", "", "main")
            .unwrap_err()
            .contains("overwritten"));
        assert_eq!(snapshot(&repo.0).unwrap().branch, "feature");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "unsaved work\n");
    }
    #[test]
    fn rollback_restores_only_unstaged_work_and_rejects_stale_reviews() {
        let repo = Repo::new();
        let file = repo.0.join("file.php");
        std::fs::write(&file, "base\n").unwrap();
        act(&repo.0, "stage", "file.php", "").unwrap();
        act(&repo.0, "commit", "", "Base").unwrap();
        std::fs::write(&file, "staged\n").unwrap();
        act(&repo.0, "stage", "file.php", "").unwrap();
        std::fs::write(&file, "unstaged\n").unwrap();
        let reviewed = diff(&repo.0, "file.php", false).unwrap();
        let before = snapshot(&repo.0).unwrap();
        let request = |patch: String| Action {
            action: "rollback".into(),
            path: "file.php".into(),
            value: String::new(),
            remote: String::new(),
            expected_head: before.head.clone(),
            expected_staged: before.staged_revision.clone(),
            paths: Vec::new(),
            reviewed_diff: Some(patch),
        };
        std::fs::write(&file, "new work\n").unwrap();
        assert!(action(&repo.0, request(reviewed))
            .unwrap_err()
            .contains("changed"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "new work\n");
        action(&repo.0, request(diff(&repo.0, "file.php", false).unwrap())).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "staged\n");
        assert!(!snapshot(&repo.0).unwrap().staged_revision.is_empty());
    }
    #[test]
    fn decodes_renames_and_conflicts() {
        let entries =
            parse_status(b"R  new name\0old name\0UU conflict.php\0?? line\nname\0").unwrap();
        assert_eq!(entries[0].original_path.as_deref(), Some("old name"));
        assert!(entries[1].conflict);
        assert_eq!(entries[2].path, "line\nname");
        assert!(path_argument("../escape").is_err());
    }
    #[test]
    fn merge_conflicts_require_marker_free_result_before_commit() {
        let repo = Repo::new();
        let file = repo.0.join("conflict.php");
        std::fs::write(&file, "base\n").unwrap();
        act(&repo.0, "stage", "conflict.php", "").unwrap();
        act(&repo.0, "commit", "", "Base").unwrap();
        act(&repo.0, "create-branch", "", "incoming").unwrap();
        std::fs::write(&file, "incoming\n").unwrap();
        act(&repo.0, "stage", "conflict.php", "").unwrap();
        act(&repo.0, "commit", "", "Incoming").unwrap();
        act(&repo.0, "switch", "", "main").unwrap();
        std::fs::write(&file, "ours\n").unwrap();
        act(&repo.0, "stage", "conflict.php", "").unwrap();
        act(&repo.0, "commit", "", "Ours").unwrap();
        act(&repo.0, "merge", "", "incoming").unwrap();
        let status = snapshot(&repo.0).unwrap();
        assert!(status.merging);
        assert!(status.entries[0].conflict);
        let versions = conflict(&repo.0, "conflict.php").unwrap();
        assert_eq!(versions.base, "base\n");
        assert_eq!(versions.ours, "ours\n");
        assert_eq!(versions.theirs, "incoming\n");
        assert!(act(&repo.0, "stage", "conflict.php", "").is_err());
        assert!(act(&repo.0, "resolve", "conflict.php", "").is_err());
        std::fs::write(&file, "ours + incoming\n").unwrap();
        act(&repo.0, "resolve", "conflict.php", "").unwrap();
        act(&repo.0, "commit", "", "Resolve merge").unwrap();
        assert!(!snapshot(&repo.0).unwrap().merging);
        assert_eq!(snapshot(&repo.0).unwrap().history.len(), 4);
    }
    #[test]
    fn rename_unstage_restores_both_paths_and_literal_pathspecs() {
        let repo = Repo::new();
        std::fs::write(repo.0.join("old name"), "original").unwrap();
        act(&repo.0, "stage", "old name", "").unwrap();
        act(&repo.0, "commit", "", "Base").unwrap();
        std::fs::rename(repo.0.join("old name"), repo.0.join("new name")).unwrap();
        run(&repo.0, &["add", "--all"]).unwrap();
        let state = snapshot(&repo.0).unwrap();
        assert_eq!(state.entries[0].original_path.as_deref(), Some("old name"));
        act(&repo.0, "unstage", "new name", "").unwrap();
        assert!(snapshot(&repo.0).unwrap().staged_revision.is_empty());
        std::fs::write(repo.0.join(":(glob)*"), "literal").unwrap();
        act(&repo.0, "stage", ":(glob)*", "").unwrap();
        let state = snapshot(&repo.0).unwrap();
        assert!(state.staged_revision.contains(":(glob)*"));
        assert!(!state.staged_revision.contains("new name"));
    }
    #[test]
    fn rejects_stale_index_before_commit_and_stale_diff_before_stage() {
        let repo = Repo::new();
        let file = repo.0.join("file");
        std::fs::write(&file, "one").unwrap();
        let reviewed = diff(&repo.0, "file", false).unwrap();
        std::fs::write(&file, "two").unwrap();
        assert!(action(
            &repo.0,
            Action {
                action: "stage".into(),
                path: "file".into(),
                value: String::new(),
                remote: String::new(),
                expected_head: String::new(),
                expected_staged: String::new(),
                paths: Vec::new(),
                reviewed_diff: Some(reviewed),
            }
        )
        .is_err());
        act(&repo.0, "stage", "file", "").unwrap();
        let before = snapshot(&repo.0).unwrap();
        std::fs::write(&file, "three").unwrap();
        act(&repo.0, "stage", "file", "").unwrap();
        assert!(action(
            &repo.0,
            Action {
                action: "commit".into(),
                path: String::new(),
                value: "stale".into(),
                remote: String::new(),
                expected_head: before.head,
                expected_staged: before.staged_revision,
                paths: Vec::new(),
                reviewed_diff: None,
            }
        )
        .is_err());
        assert!(snapshot(&repo.0).unwrap().head.is_empty());
    }
    #[test]
    fn pushes_fetches_and_fast_forward_pulls_from_disposable_local_remote() {
        let repo = Repo::new();
        let remote = Repo::new();
        run(
            &remote.0,
            &["config", "receive.denyCurrentBranch", "ignore"],
        )
        .unwrap();
        std::fs::write(repo.0.join("file"), "one").unwrap();
        act(&repo.0, "stage", "file", "").unwrap();
        act(&repo.0, "commit", "", "Base").unwrap();
        run(
            &repo.0,
            &["remote", "add", "origin", &remote.0.to_string_lossy()],
        )
        .unwrap();
        let network = |action_name: &str| {
            let before = snapshot(&repo.0).unwrap();
            action(
                &repo.0,
                Action {
                    action: action_name.into(),
                    path: String::new(),
                    value: String::new(),
                    remote: "origin".into(),
                    expected_head: before.head,
                    expected_staged: before.staged_revision,
                    paths: Vec::new(),
                    reviewed_diff: None,
                },
            )
        };
        network("push").unwrap();
        let first = snapshot(&repo.0).unwrap().head;
        assert_eq!(snapshot(&remote.0).unwrap().head, first);
        // Update the remote index/worktree to its pushed HEAD, then create a second commit there.
        run(&remote.0, &["reset", "--hard", "HEAD"]).unwrap();
        std::fs::write(remote.0.join("file"), "two").unwrap();
        act(&remote.0, "stage", "file", "").unwrap();
        act(&remote.0, "commit", "", "Remote update").unwrap();
        network("fetch").unwrap();
        assert_eq!(snapshot(&repo.0).unwrap().head, first);
        network("pull").unwrap();
        assert_eq!(std::fs::read_to_string(repo.0.join("file")).unwrap(), "two");
    }
    #[test]
    fn explicit_merge_abort_restores_pre_merge_files() {
        let repo = Repo::new();
        let file = repo.0.join("file");
        std::fs::write(&file, "base").unwrap();
        act(&repo.0, "stage", "file", "").unwrap();
        act(&repo.0, "commit", "", "Base").unwrap();
        act(&repo.0, "create-branch", "", "incoming").unwrap();
        std::fs::write(&file, "incoming").unwrap();
        act(&repo.0, "stage", "file", "").unwrap();
        act(&repo.0, "commit", "", "Incoming").unwrap();
        act(&repo.0, "switch", "", "main").unwrap();
        std::fs::write(&file, "ours").unwrap();
        act(&repo.0, "stage", "file", "").unwrap();
        act(&repo.0, "commit", "", "Ours").unwrap();
        act(&repo.0, "merge", "", "incoming").unwrap();
        assert!(snapshot(&repo.0).unwrap().merging);
        act(&repo.0, "abort-merge", "", "").unwrap();
        assert!(!snapshot(&repo.0).unwrap().merging);
        assert_eq!(std::fs::read_to_string(file).unwrap(), "ours");
    }
    #[test]
    fn selected_hunks_stage_and_unstage_without_touching_working_tree() {
        let repo = Repo::new();
        let original = (1..=40)
            .map(|line| format!("line {line}\n"))
            .collect::<String>();
        std::fs::write(repo.0.join("file"), &original).unwrap();
        act(&repo.0, "stage", "file", "").unwrap();
        act(&repo.0, "commit", "", "Base").unwrap();
        let edited = original
            .replace("line 2\n", "first change\n")
            .replace("line 35\n", "second change\n");
        std::fs::write(repo.0.join("file"), &edited).unwrap();
        let patch = hunks(&repo.0, "file", false).unwrap();
        assert!(patch.supported);
        assert_eq!(patch.hunks.len(), 2);
        let state = snapshot(&repo.0).unwrap();
        apply_hunks(
            &repo.0,
            HunkRequest {
                path: "file".into(),
                staged: false,
                reviewed_patch: patch.patch,
                selected: vec![0],
                expected_head: state.head,
                expected_staged: state.staged_revision,
            },
        )
        .unwrap();
        let staged = diff(&repo.0, "file", true).unwrap();
        assert!(staged.contains("+first change"));
        assert!(!staged.contains("+second change"));
        assert_eq!(
            std::fs::read_to_string(repo.0.join("file")).unwrap(),
            edited
        );
        let patch = hunks(&repo.0, "file", true).unwrap();
        let state = snapshot(&repo.0).unwrap();
        apply_hunks(
            &repo.0,
            HunkRequest {
                path: "file".into(),
                staged: true,
                reviewed_patch: patch.patch,
                selected: vec![0],
                expected_head: state.head,
                expected_staged: state.staged_revision,
            },
        )
        .unwrap();
        assert!(snapshot(&repo.0).unwrap().staged_revision.is_empty());
        assert_eq!(
            std::fs::read_to_string(repo.0.join("file")).unwrap(),
            edited
        );
        assert!(show_commit(&repo.0, &snapshot(&repo.0).unwrap().head)
            .unwrap()
            .contains("Base"));
        assert!(show_commit(&repo.0, "HEAD;echo bad").is_err());
    }
    #[test]
    fn branch_management_stash_selection_and_revert_leave_reviewable_state() {
        let repo = Repo::new();
        std::fs::write(repo.0.join("file.txt"), "base\n").unwrap();
        run(&repo.0, &["add", "."]).unwrap();
        run(&repo.0, &["commit", "-m", "base"]).unwrap();
        run(&repo.0, &["branch", "old-name"]).unwrap();
        act(&repo.0, "rename-branch", "old-name", "new-name").unwrap();
        assert!(snapshot(&repo.0)
            .unwrap()
            .branches
            .contains(&"new-name".into()));
        assert!(act(&repo.0, "delete-branch", "main", "").is_err());
        act(&repo.0, "delete-branch", "new-name", "").unwrap();
        std::fs::write(repo.0.join("file.txt"), "first stash\n").unwrap();
        act(&repo.0, "stash", "", "").unwrap();
        let first = stashes(&repo.0).unwrap().remove(0);
        std::fs::write(repo.0.join("file.txt"), "second stash\n").unwrap();
        act(&repo.0, "stash", "", "").unwrap();
        assert!(act(&repo.0, "stash-drop", &first.reference, &first.hash).is_err());
        let list = stashes(&repo.0).unwrap();
        assert_eq!(list.len(), 2);
        act(&repo.0, "stash-apply", &list[1].reference, &list[1].hash).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.0.join("file.txt")).unwrap(),
            "first stash\n"
        );
        assert_eq!(stashes(&repo.0).unwrap().len(), 2);
        run(&repo.0, &["restore", "file.txt"]).unwrap();
        act(&repo.0, "stash-drop", &list[0].reference, &list[0].hash).unwrap();
        assert_eq!(stashes(&repo.0).unwrap().len(), 1);
        std::fs::write(repo.0.join("file.txt"), "updated\n").unwrap();
        run(&repo.0, &["add", "."]).unwrap();
        run(&repo.0, &["commit", "-m", "update"]).unwrap();
        let head = snapshot(&repo.0).unwrap().head;
        act(&repo.0, "revert", "", &head).unwrap();
        let after = snapshot(&repo.0).unwrap();
        assert_eq!(after.head, head);
        assert!(!after.staged_revision.is_empty());
        assert_eq!(
            std::fs::read_to_string(repo.0.join("file.txt")).unwrap(),
            "base\n"
        );
        assert!(act(&repo.0, "revert", "", &head).is_err());
    }
    #[test]
    fn unmerged_branches_are_not_deleted() {
        let repo = Repo::new();
        run(&repo.0, &["commit", "--allow-empty", "-m", "base"]).unwrap();
        run(&repo.0, &["switch", "-c", "feature"]).unwrap();
        run(&repo.0, &["commit", "--allow-empty", "-m", "feature"]).unwrap();
        run(&repo.0, &["switch", "main"]).unwrap();
        assert!(act(&repo.0, "delete-branch", "feature", "").is_err());
        assert!(snapshot(&repo.0)
            .unwrap()
            .branches
            .contains(&"feature".into()));
    }
    #[test]
    fn conflicted_reverts_offer_abort_without_losing_the_pre_revert_commit() {
        let repo = Repo::new();
        for (text, message) in [
            ("base\n", "base"),
            ("updated\n", "update"),
            ("later\n", "later"),
        ] {
            std::fs::write(repo.0.join("file.txt"), text).unwrap();
            run(&repo.0, &["add", "."]).unwrap();
            run(&repo.0, &["commit", "-m", message]).unwrap();
        }
        let head = snapshot(&repo.0).unwrap().head;
        let older = string(&repo.0, &["rev-parse", "HEAD~1"])
            .unwrap()
            .trim()
            .to_owned();
        act(&repo.0, "revert", "", &older).unwrap();
        let status = snapshot(&repo.0).unwrap();
        assert!(status.reverting);
        assert!(status.entries.iter().any(|entry| entry.conflict));
        assert!(act(&repo.0, "create-branch", "", "blocked").is_err());
        act(&repo.0, "abort-revert", "", "").unwrap();
        assert!(!snapshot(&repo.0).unwrap().reverting);
        assert_eq!(snapshot(&repo.0).unwrap().head, head);
        assert_eq!(
            std::fs::read_to_string(repo.0.join("file.txt")).unwrap(),
            "later\n"
        );
    }
}
