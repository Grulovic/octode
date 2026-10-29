import { changedIds } from "../lib/toolChanges";
import CustomSelect from "./CustomSelect";
import PanelResize, { usePanelSize } from "./PanelResize";
import type { SearchEntry } from "../lib/searchEverywhere";
import { useToolView } from "../hooks/useToolView";
import JsonResponse from "./JsonResponse";
import VariableInput from "./VariableInput";
import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Plus,
  Send,
  Trash2,
  Pencil,
  ArrowLeft,
} from "lucide-react";
import { useToolDocument } from "../hooks/useToolDocument";
import { apiDocument, apiRequest, id } from "../lib/toolDefaults";
import { nativeTool } from "../lib/toolsBridge";
import {
  exportCollection,
  importCollection,
  mergeCollection,
  boundedHistory,
  duplicateRequest,
} from "../lib/apiCollections";
import { exportText } from "../lib/export";
import { invoke } from "../lib/bridge";
import type { ApiRequest, ApiResponse } from "../toolTypes";
import {
  ToolLayout,
  Field,
  SecretField,
  ValueRows,
  EmptyTool,
  confirmAction,
  type ToolProps,
} from "./ToolLayout";
export default function ApiWorkspace({
  project,
  onError,
  onDirty,
  searchTarget,
}: ToolProps) {
  const {
    document: doc,
    savedDocument,
    setDocument: set,
    loading,
    saving,
    saveError,
    changes,
    dirty,
    save,
  } = useToolDocument(project, "api", apiDocument, onError, onDirty);
  const dirtyRequests = changedIds(doc.requests, savedDocument.requests);
  const dirtyFolders = changedIds(doc.folders, savedDocument.folders);
  for (const request of [...doc.requests, ...savedDocument.requests]) {
    const before = savedDocument.requests.find(
      (item) => item.id === request.id,
    );
    const after = doc.requests.find((item) => item.id === request.id);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      if (before?.folderId) dirtyFolders.add(before.folderId);
      if (after?.folderId) dirtyFolders.add(after.folderId);
    }
  }
  const [requestSearch, setRequestSearch] = useState("");
  const requestSearchInput = useRef<HTMLInputElement>(null);
  const requestQuery = requestSearch.trim().toLocaleLowerCase();
  const matchesRequest = (request: ApiRequest) =>
    !requestQuery ||
    `${request.name} ${request.method} ${request.url}`
      .toLocaleLowerCase()
      .includes(requestQuery);
  const visibleRequests = doc.requests.filter(
    (request) =>
      matchesRequest(request) ||
      (requestQuery &&
        doc.folders.some(
          (folder) =>
            folder.id === request.folderId &&
            folder.name.toLocaleLowerCase().includes(requestQuery),
        )),
  );
  const visibleRequestIds = new Set(
    visibleRequests.map((request) => request.id),
  );
  const responsePanel = useRef<HTMLDivElement>(null);
  const [responseHeight, setResponseHeight] = usePanelSize(
    "octode-layout:api-response-height",
    360,
  );
  const [sidebarTab, setSidebarTab] = useToolView<"requests" | "history">(
    project.id,
    "ApiWorkspace:sidebarTab",
    "requests",
  );
  const [selected, select] = useToolView(
    project.id,
    "ApiWorkspace:selected",
    "",
  );
  const [collapsedFolders, setCollapsedFolders] = useToolView<string[]>(
    project.id,
    "ApiWorkspace:collapsedFolders",
    [],
  );
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const cancelFolderRename = useRef(false);
  const editFolder = (folder: { id: string; name: string }) => {
    cancelFolderRename.current = false;
    setFolderDraft(folder.name);
    setEditingFolder(folder.id);
  };
  const draggedRequest = useRef<string | null>(null);
  const pointerDrag = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressRequestClick = useRef(false);
  const moveRequest = (requestId: string, folderId: string) =>
    set((previous) => {
      if (
        folderId &&
        !previous.folders.some((folder) => folder.id === folderId)
      )
        return previous;
      return {
        ...previous,
        requests: previous.requests.map((item) =>
          item.id === requestId ? { ...item, folderId } : item,
        ),
      };
    });
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const drag = pointerDrag.current;
      if (!drag) return;
      if (
        !drag.moved &&
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6
      )
        return;
      drag.moved = true;
      event.preventDefault();
      const target = window.document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-request-folder]");
      setDropFolder(target?.dataset.requestFolder ?? null);
    };
    const finish = (event: MouseEvent) => {
      const drag = pointerDrag.current;
      pointerDrag.current = null;
      if (drag?.moved) {
        const target = window.document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[data-request-folder]");
        if (target) {
          const folderId = target.dataset.requestFolder ?? "";
          set((previous) =>
            !folderId ||
            previous.folders.some((folder) => folder.id === folderId)
              ? {
                  ...previous,
                  requests: previous.requests.map((item) =>
                    item.id === drag.id ? { ...item, folderId } : item,
                  ),
                }
              : previous,
          );
        }
        suppressRequestClick.current = true;
        setTimeout(() => {
          suppressRequestClick.current = false;
        }, 0);
      }
      setDropFolder(null);
    };
    const cancel = () => {
      pointerDrag.current = null;
      setDropFolder(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", cancel);
    };
  }, [set]);

  const [tab, setTab] = useToolView(project.id, "ApiWorkspace:tab", "params");
  const [env, setEnv] = useToolView(project.id, "ApiWorkspace:env", "");
  const [responses, setResponses] = useState<Record<string, ApiResponse>>({});
  const [history, setHistory] = useState<
    {
      id: string;
      requestId: string;
      name: string;
      method: string;
      url: string;
      time: string;
      response: ApiResponse;
    }[]
  >([]);
  const [pretty, setPretty] = useState(true);
  const [responseTab, setResponseTab] = useState("body");
  const [running, setRunning] = useState(false);
  const operation = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (operation.current)
        void nativeTool("cancel_operation", {
          operationId: operation.current,
        }).catch(() => {});
    };
  }, []);
  const handledSearch = useRef<SearchEntry | undefined>(undefined);
  useEffect(() => {
    if (
      loading ||
      !searchTarget ||
      searchTarget.target?.tool !== "api" ||
      handledSearch.current === searchTarget
    )
      return;
    handledSearch.current = searchTarget;
    setSidebarTab("requests");
    const { id } = searchTarget.target;
    if (searchTarget.kind === "environment") {
      setEnv(id);
      setTab("environment");
    } else if (searchTarget.kind === "folder") {
      setCollapsedFolders((previous) =>
        previous.filter((value) => value !== id),
      );
      const request = doc.requests.find((item) => item.folderId === id);
      if (request) select(request.id);
      setTab("params");
    } else {
      select(id);
      setTab("params");
      const request = doc.requests.find((item) => item.id === id);
      if (request)
        setCollapsedFolders((previous) =>
          previous.filter((value) => value !== request.folderId),
        );
    }
  }, [searchTarget, loading]);
  const current = doc.requests.find((item) => item.id === selected);
  const response = current ? responses[current.id] : undefined;
  const duplicate = (request: ApiRequest) => {
    const copy = duplicateRequest(
      request,
      doc.requests.map((item) => item.name),
    );
    set((previous) => ({
      ...previous,
      requests: previous.requests.flatMap((item) =>
        item.id === request.id ? [item, copy] : [item],
      ),
    }));
    select(copy.id);
  };
  const remove = async (request: ApiRequest) => {
    if (running || !(await confirmAction(`Delete “${request.name}”?`))) return;
    set((previous) => ({
      ...previous,
      requests: previous.requests.filter((item) => item.id !== request.id),
    }));
    select((previous) => (previous === request.id ? "" : previous));
    setResponses((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => key !== request.id),
      ),
    );
    setHistory((previous) =>
      previous.filter((item) => item.requestId !== request.id),
    );
  };

  const patch = (value: Partial<ApiRequest>) =>
    set((previous) => ({
      ...previous,
      requests: previous.requests.map((item) =>
        item.id === selected ? { ...item, ...value } : item,
      ),
    }));
  const add = () => {
    const request = apiRequest();
    set((previous) => ({
      ...previous,
      requests: [...previous.requests, request],
    }));
    select(request.id);
  };
  const send = async () => {
    if (!current || running) return;
    const operationId = id();
    operation.current = operationId;
    setRunning(true);
    try {
      const value = await nativeTool<ApiResponse>("api_send", {
        projectId: project.id,
        operationId,
        request: current,
        environment:
          doc.environments.find((item) => item.id === env)?.variables ?? [],
      });
      if (alive.current) {
        setHistory((previous) =>
          boundedHistory([
            {
              id: id(),
              requestId: current.id,
              name: current.name,
              method: current.method,
              url: current.url,
              time: new Date().toLocaleTimeString(),
              response: value,
            },
            ...previous,
          ]),
        );
        setResponses((previous) =>
          Object.fromEntries([
            ...Object.entries(previous)
              .filter(([key]) => key !== current.id)
              .slice(-3),
            [current.id, value],
          ]),
        );
      }
    } catch (error) {
      if (alive.current) onError(String(error));
    } finally {
      operation.current = null;
      if (alive.current) setRunning(false);
    }
  };
  const importFile = async () => {
    try {
      const path = await (
        await import("@tauri-apps/plugin-dialog")
      ).open({
        title: "Import Octode or Postman collection",
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      const raw = await invoke<string>("read_import_file", { path });
      const incoming = importCollection(raw);
      if (
        await confirmAction(
          `Import ${incoming.requests.length} requests and ${incoming.folders.length} folders into this project? Use Save to keep the imported collection.`,
        )
      )
        set((previous) => mergeCollection(previous, incoming));
    } catch (reason) {
      onError(String(reason));
    }
  };
  const sidebar = (
    <>
      <div
        className="service-tabs api-sidebar-tabs"
        role="tablist"
        aria-label="API sidebar"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "requests"
              : event.key === "End"
                ? "history"
                : sidebarTab === "requests"
                  ? "history"
                  : "requests";
          setSidebarTab(next);
          event.currentTarget
            .querySelector<HTMLButtonElement>(`#api-${next}-tab`)
            ?.focus();
        }}
      >
        {(["requests", "history"] as const).map((value) => (
          <button
            key={value}
            id={`api-${value}-tab`}
            role="tab"
            aria-selected={sidebarTab === value}
            aria-controls={`api-${value}-panel`}
            tabIndex={sidebarTab === value ? 0 : -1}
            className={sidebarTab === value ? "active" : ""}
            onClick={() => setSidebarTab(value)}
          >
            {value === "requests" ? "Requests" : "History"}
          </button>
        ))}
      </div>
      <div
        id="api-requests-panel"
        className="api-sidebar-panel"
        role="tabpanel"
        aria-labelledby="api-requests-tab"
        hidden={sidebarTab !== "requests"}
      >
        <div className="api-request-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={requestSearchInput}
            aria-label="Search requests"
            placeholder="Search requests…"
            value={requestSearch}
            onChange={(event) => setRequestSearch(event.target.value)}
          />
          {requestSearch && (
            <button
              type="button"
              aria-label="Clear request search"
              title="Clear request search"
              onClick={() => {
                setRequestSearch("");
                requestSearchInput.current?.focus();
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <div
          className={`service-subheading api-request-heading ${dropFolder === "" ? "request-folder-drop" : ""}`}
          data-request-folder=""
          title="Drop requests here to move them out of a folder"
          onDragOver={(event) => {
            if (!draggedRequest.current) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropFolder("");
          }}
          onDragLeave={() => setDropFolder(null)}
          onDrop={(event) => {
            const request = draggedRequest.current;
            if (!request) return;
            event.preventDefault();
            event.stopPropagation();
            draggedRequest.current = null;
            setDropFolder(null);
            moveRequest(request, "");
          }}
        >
          <span className="api-request-actions-spacer" />
          <button
            title="New folder"
            onClick={() => {
              const folder = { id: id(), name: "New folder" };
              set((previous) => ({
                ...previous,
                folders: [...previous.folders, folder],
              }));
              editFolder(folder);
            }}
          >
            <FolderPlus size={15} />
          </button>
          <button title="New request" onClick={add}>
            <Plus size={15} />
          </button>
        </div>
        {[{ id: "", name: "Unfiled" }, ...doc.folders]
          .filter(
            (folder) =>
              !requestQuery ||
              visibleRequests.some(
                (request) => request.folderId === folder.id,
              ) ||
              folder.name.toLocaleLowerCase().includes(requestQuery),
          )
          .map((folder) => (
            <div
              className={`request-folder ${!folder.id ? "root-requests" : ""} ${dropFolder === folder.id ? "request-folder-drop" : ""}`}
              key={folder.id}
              role="group"
              data-request-folder={folder.id}
              aria-label={`Request folder ${folder.name}`}
              onDragOver={(event) => {
                if (!draggedRequest.current) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropFolder(folder.id);
              }}
              onDragLeave={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget)
                )
                  return;
                setDropFolder((previous) =>
                  previous === folder.id ? null : previous,
                );
              }}
              onDrop={(event) => {
                const requestId = draggedRequest.current;
                if (!requestId) return;
                event.preventDefault();
                event.stopPropagation();
                draggedRequest.current = null;
                setDropFolder(null);
                set((previous) => {
                  if (
                    folder.id &&
                    !previous.folders.some((item) => item.id === folder.id)
                  )
                    return previous;
                  return {
                    ...previous,
                    requests: previous.requests.map((item) =>
                      item.id === requestId
                        ? { ...item, folderId: folder.id }
                        : item,
                    ),
                  };
                });
              }}
            >
              {folder.id ? (
                <div className="folder-heading">
                  <button
                    className={`folder-toggle ${editingFolder === folder.id ? "" : "folder-name-button"}`}
                    aria-label={`${!requestQuery && collapsedFolders.includes(folder.id) ? "Expand" : "Collapse"} folder ${folder.name}`}
                    aria-expanded={
                      !(!requestQuery && collapsedFolders.includes(folder.id))
                    }
                    title={
                      !requestQuery && collapsedFolders.includes(folder.id)
                        ? "Expand folder"
                        : "Collapse folder"
                    }
                    onClick={() =>
                      setCollapsedFolders((previous) =>
                        previous.includes(folder.id)
                          ? previous.filter((id) => id !== folder.id)
                          : [...previous, folder.id],
                      )
                    }
                  >
                    {!requestQuery && collapsedFolders.includes(folder.id) ? (
                      <ChevronRight size={18} />
                    ) : (
                      <ChevronDown size={18} />
                    )}
                    {editingFolder !== folder.id && (
                      <span title={folder.name}>{folder.name}</span>
                    )}
                    {dirtyFolders.has(folder.id) && (
                      <span
                        className="tool-unsaved-dot"
                        role="img"
                        aria-label={`Unsaved changes in folder ${folder.name}`}
                        title="Folder contains unsaved changes"
                      />
                    )}
                  </button>
                  {editingFolder === folder.id && (
                    <input
                      aria-label="Folder name"
                      autoFocus
                      value={folderDraft}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setFolderDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== "Escape")
                          return;
                        event.preventDefault();
                        cancelFolderRename.current = event.key === "Escape";
                        event.currentTarget.blur();
                      }}
                      onBlur={() => {
                        if (!cancelFolderRename.current) {
                          const name = folderDraft.trim() || folder.name;
                          set((previous) => ({
                            ...previous,
                            folders: previous.folders.map((item) =>
                              item.id === folder.id ? { ...item, name } : item,
                            ),
                          }));
                        }
                        setEditingFolder(null);
                      }}
                    />
                  )}
                  <button
                    className="folder-edit"
                    title="Edit folder name"
                    aria-label={`Edit folder ${folder.name}`}
                    onClick={() => editFolder(folder)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="folder-delete"
                    title="Remove folder (keep requests)"
                    onClick={() =>
                      set((previous) => ({
                        ...previous,
                        folders: previous.folders.filter(
                          (item) => item.id !== folder.id,
                        ),
                        requests: previous.requests.map((item) =>
                          item.folderId === folder.id
                            ? { ...item, folderId: "" }
                            : item,
                        ),
                      }))
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ) : null}
              {(!!requestQuery ||
                !folder.id ||
                !collapsedFolders.includes(folder.id)) &&
                doc.requests
                  .filter(
                    (request) =>
                      request.folderId === folder.id &&
                      visibleRequestIds.has(request.id),
                  )
                  .map((request) => (
                    <div
                      key={request.id}
                      className={`api-request-row api-route-row ${selected === request.id ? "selected" : ""}`}
                      draggable={false}
                      title="Drag to a folder to move this request"
                      onMouseDown={(event) => {
                        if (
                          event.button !== 0 ||
                          (event.target as Element).closest(
                            ".api-request-action",
                          )
                        )
                          return;
                        event.preventDefault();
                        pointerDrag.current = {
                          id: request.id,
                          x: event.clientX,
                          y: event.clientY,
                          moved: false,
                        };
                      }}
                      onPointerDown={(event) => {
                        if (
                          event.button !== 0 ||
                          (event.target as Element).closest(
                            ".api-request-action",
                          )
                        )
                          return;
                        pointerDrag.current = {
                          id: request.id,
                          x: event.clientX,
                          y: event.clientY,
                          moved: false,
                        };
                      }}
                      onPointerMove={(event) => {
                        const drag = pointerDrag.current;
                        if (!drag) return;
                        if (
                          !drag.moved &&
                          Math.hypot(
                            event.clientX - drag.x,
                            event.clientY - drag.y,
                          ) < 6
                        )
                          return;
                        if (!drag.moved)
                          event.currentTarget.setPointerCapture?.(
                            event.pointerId,
                          );
                        drag.moved = true;
                        event.preventDefault();
                        const target = window.document
                          .elementFromPoint(event.clientX, event.clientY)
                          ?.closest<HTMLElement>("[data-request-folder]");
                        setDropFolder(target?.dataset.requestFolder ?? null);
                        const sidebar =
                          event.currentTarget.closest<HTMLElement>(
                            ".service-sidebar",
                          );
                        if (sidebar) {
                          const bounds = sidebar.getBoundingClientRect();
                          if (event.clientY > bounds.bottom - 30)
                            sidebar.scrollTop += 12;
                          else if (event.clientY < bounds.top + 30)
                            sidebar.scrollTop -= 12;
                        }
                      }}
                      onPointerUp={(event) => {
                        const drag = pointerDrag.current;
                        pointerDrag.current = null;
                        if (drag?.moved) {
                          const target = window.document
                            .elementFromPoint(event.clientX, event.clientY)
                            ?.closest<HTMLElement>("[data-request-folder]");
                          if (target)
                            moveRequest(
                              drag.id,
                              target.dataset.requestFolder ?? "",
                            );
                          suppressRequestClick.current = true;
                          setTimeout(() => {
                            suppressRequestClick.current = false;
                          }, 0);
                        }
                        setDropFolder(null);
                      }}
                      onPointerCancel={() => {
                        pointerDrag.current = null;
                        setDropFolder(null);
                      }}
                      onLostPointerCapture={() => {
                        pointerDrag.current = null;
                        setDropFolder(null);
                      }}
                      onDragStart={(event) => {
                        draggedRequest.current = request.id;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData(
                          "application/x-octode-api-request",
                          request.id,
                        );
                      }}
                      onDragEnd={() => {
                        draggedRequest.current = null;
                        setDropFolder(null);
                      }}
                    >
                      <button
                        className="service-list-item"
                        title={request.name}
                        onClick={() => {
                          if (!suppressRequestClick.current) select(request.id);
                        }}
                      >
                        <span
                          className="http-method"
                          data-method={request.method}
                        >
                          {request.method}
                        </span>
                        <span className="api-request-name">{request.name}</span>
                        {dirtyRequests.has(request.id) && (
                          <span
                            className="tool-unsaved-dot"
                            role="img"
                            aria-label={`Unsaved request ${request.name}`}
                            title="Unsaved request changes"
                          />
                        )}
                      </button>
                      <button
                        className="api-request-action"
                        aria-label={`Duplicate request ${request.name}`}
                        title="Duplicate request"
                        onClick={() => duplicate(request)}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="api-request-action"
                        aria-label={`Delete request ${request.name}`}
                        title="Delete request"
                        disabled={running}
                        onClick={() => void remove(request)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
            </div>
          ))}
        {requestQuery && !visibleRequests.length && (
          <p className="api-request-search-empty">No matching requests.</p>
        )}
      </div>
      <div
        id="api-history-panel"
        className="api-sidebar-panel"
        role="tabpanel"
        aria-labelledby="api-history-tab"
        hidden={sidebarTab !== "history"}
      >
        <div className="service-subheading">
          <strong>Current session</strong>
          <button
            aria-label="Clear API history"
            disabled={!history.length}
            onClick={() => setHistory([])}
          >
            Clear
          </button>
        </div>
        {!history.length && (
          <p className="service-hint api-history-empty">
            No requests sent this session.
          </p>
        )}
        {history.map((item) => (
          <button
            key={item.id}
            className="service-list-item"
            disabled={
              !doc.requests.some((request) => request.id === item.requestId)
            }
            onClick={() => {
              select(item.requestId);
              setTab("params");
              setResponses((previous) => ({
                ...previous,
                [item.requestId]: item.response,
              }));
            }}
            title={`${item.method} ${item.url}`}
          >
            <span>
              {item.response.status} · {item.name}
              <small>
                {item.time} · {item.response.elapsedMs} ms
              </small>
            </span>
          </button>
        ))}
      </div>
    </>
  );
  const environment = doc.environments.find((item) => item.id === env);
  const createEnvironment = () => {
    const environment = { id: id(), name: "New environment", variables: [] };
    set((previous) => ({
      ...previous,
      environments: [...previous.environments, environment],
    }));
    setEnv(environment.id);
    setTab("environment");
  };
  const deleteEnvironment = async () => {
    if (
      !environment ||
      !(await confirmAction(
        `Delete environment “${environment.name}”? Use Save to keep this change.`,
      ))
    )
      return;
    set((previous) => ({
      ...previous,
      environments: previous.environments.filter((item) => item.id !== env),
    }));
    setEnv("");
    setTab("params");
  };
  const toolbarActions = (
    <>
      <div className="api-environment-actions">
        <label className="api-header-environment">
          <span>Environment</span>
          <CustomSelect
            disabled={loading}
            aria-label="Active environment"
            value={env}
            onChange={(event) => setEnv(event.target.value)}
          >
            <option value="">No environment</option>
            {doc.environments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </CustomSelect>
        </label>
        <button
          disabled={loading}
          className="secondary-button environment-icon-button"
          title="Create environment"
          aria-label="New environment"
          onClick={createEnvironment}
        >
          <Plus size={16} />
        </button>
        {environment && (
          <>
            <button
              disabled={loading}
              className="secondary-button environment-icon-button"
              title="Edit environment"
              aria-label="Edit environment"
              onClick={() => setTab("environment")}
            >
              <Pencil size={16} />
            </button>
            <button
              disabled={loading}
              className="secondary-button environment-icon-button"
              title="Delete environment"
              aria-label="Delete environment"
              onClick={() => void deleteEnvironment()}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
      <div className="api-collection-actions">
        <button
          disabled={loading}
          className="secondary-button"
          onClick={() => void importFile()}
        >
          Import collection
        </button>
        <button
          disabled={loading}
          className="secondary-button"
          onClick={() =>
            void exportText(
              exportCollection(doc),
              "octode-api.json",
              "Export collection without secrets",
            ).catch((reason) => onError(String(reason)))
          }
        >
          Export collection
        </button>
      </div>
    </>
  );
  return (
    <ToolLayout
      title="API"
      mainClassName="api-main"
      {...{
        dirty,
        saving,
        save,
        sidebar,
        toolbarActions,
        loading,
        saveError,
        changes,
      }}
    >
      <div
        className="service-tabs api-request-tabs"
        hidden={tab === "environment"}
      >
        {["params", "headers", "body", "auth"].map((value) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <div className="service-content api-request-content">
        {current && tab !== "environment" && (
          <>
            <div className="request-name-row">
              <Field label="Request name">
                <input
                  aria-label="Request name"
                  value={current.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </Field>
              <button
                className="api-request-action"
                title="Delete request"
                aria-label="Delete selected request"
                disabled={running}
                onClick={() => void remove(current)}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <div className="request-bar">
              <CustomSelect
                aria-label="HTTP method"
                data-method={current.method}
                value={current.method}
                onChange={(e) => patch({ method: e.target.value })}
              >
                {[
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "HEAD",
                  "OPTIONS",
                ].map((method) => (
                  <option key={method} data-method={method}>
                    {method}
                  </option>
                ))}
              </CustomSelect>
              <VariableInput
                aria-label="Request URL"
                placeholder="https://api.example.com/users"
                value={current.url}
                onChange={(e) => patch({ url: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void send();
                }}
              />
              <button
                className="primary-button"
                disabled={running || !current.url}
                onClick={() => void send()}
              >
                <Send size={14} />
                {running ? "Sending…" : "Send"}
              </button>
              {running && (
                <button
                  onClick={() =>
                    void nativeTool("cancel_operation", {
                      operationId: operation.current,
                    }).catch((error) => onError(String(error)))
                  }
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
        {tab === "environment" && (
          <button className="secondary-button" onClick={() => setTab("params")}>
            <ArrowLeft size={16} />
            Back to request
          </button>
        )}
        {tab === "environment" ? (
          environment ? (
            <>
              <div className="service-subheading">
                <Field label="Environment name">
                  <input
                    value={environment.name}
                    onChange={(e) =>
                      set((previous) => ({
                        ...previous,
                        environments: previous.environments.map((item) =>
                          item.id === env
                            ? { ...item, name: e.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                </Field>
              </div>
              <ValueRows
                label="Variables"
                values={environment.variables}
                onChange={(variables) =>
                  set((previous) => ({
                    ...previous,
                    environments: previous.environments.map((item) =>
                      item.id === env ? { ...item, variables } : item,
                    ),
                  }))
                }
              />
            </>
          ) : (
            <p className="service-hint">
              Create or select an environment above.
            </p>
          )
        ) : !current ? (
          <EmptyTool title="Make your first request">
            Create a request, add its URL, and Send. Use Save to keep your
            changes.
          </EmptyTool>
        ) : (
          <>
            {tab === "params" && (
              <ValueRows
                label="Parameters"
                values={current.params}
                onChange={(params) => patch({ params })}
              />
            )}{" "}
            {tab === "headers" && (
              <ValueRows
                label="Headers"
                values={current.headers}
                onChange={(headers) => patch({ headers })}
              />
            )}{" "}
            {tab === "body" && (
              <>
                <Field label="Body type">
                  <CustomSelect
                    value={current.bodyMode}
                    onChange={(e) =>
                      patch({
                        bodyMode: e.target.value as ApiRequest["bodyMode"],
                      })
                    }
                  >
                    {["none", "json", "text", "form", "multipart"].map(
                      (mode) => (
                        <option key={mode}>{mode}</option>
                      ),
                    )}
                  </CustomSelect>
                </Field>
                {["json", "text"].includes(current.bodyMode) && (
                  <textarea
                    className="service-code-input"
                    aria-label="Request body"
                    spellCheck={false}
                    value={current.body}
                    onChange={(e) => patch({ body: e.target.value })}
                  />
                )}{" "}
                {["form", "multipart"].includes(current.bodyMode) && (
                  <ValueRows
                    label="Form fields"
                    values={current.form}
                    onChange={(form) => patch({ form })}
                    files={current.bodyMode === "multipart"}
                  />
                )}
              </>
            )}{" "}
            {tab === "auth" && (
              <div className="service-form-grid">
                <Field label="Authentication">
                  <CustomSelect
                    value={current.auth}
                    onChange={(e) =>
                      patch({ auth: e.target.value as ApiRequest["auth"] })
                    }
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer token</option>
                    <option value="basic">Basic authentication</option>
                  </CustomSelect>
                </Field>
                {current.auth === "basic" && (
                  <Field label="Username">
                    <input
                      value={current.username}
                      onChange={(e) => patch({ username: e.target.value })}
                    />
                  </Field>
                )}
                {current.auth !== "none" && (
                  <SecretField
                    label={current.auth === "bearer" ? "Token" : "Password"}
                    value={current.credential}
                    onChange={(credential) => patch({ credential })}
                  />
                )}
                <Field label="Timeout (seconds)">
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={current.timeoutSeconds}
                    onChange={(e) =>
                      patch({ timeoutSeconds: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
            )}
          </>
        )}
      </div>
      {current && tab !== "environment" && (
        <div
          ref={responsePanel}
          className={`response-panel ${response ? "has-response" : ""}`}
          style={response ? { height: responseHeight } : undefined}
        >
          {response && (
            <PanelResize
              target={responsePanel}
              size={responseHeight}
              onResize={setResponseHeight}
              axis="y"
              label="Resize API response"
              title="Drag upward to enlarge response"
              className="terminal-resize response-resize"
            />
          )}
          <div className="service-subheading">
            <strong>Last response</strong>
            {response ? (
              <span className="response-summary">
                {response.status} {response.statusText} · {response.elapsedMs}{" "}
                ms · {response.bytes.toLocaleString()} bytes
                {response.truncated ? " · Truncated at 2 MB" : ""}
              </span>
            ) : (
              <span className="service-hint">
                Send this request to see its response.
              </span>
            )}
          </div>
          {response && (
            <>
              <div className="service-tabs api-response-tabs">
                {["body", "headers"].map((value) => (
                  <button
                    key={value}
                    className={responseTab === value ? "active" : ""}
                    onClick={() => setResponseTab(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              {response.binary && responseTab === "body" && (
                <p className="service-hint">Binary response shown as base64.</p>
              )}
              <div className="service-subheading">
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={pretty}
                    onChange={(event) => setPretty(event.target.checked)}
                  />
                  Format JSON
                </label>
                <button
                  onClick={() =>
                    void exportText(
                      response.body,
                      response.binary ? "response.base64.txt" : "response.txt",
                      "Export displayed response",
                    ).catch((reason) => onError(String(reason)))
                  }
                >
                  Export response
                </button>
              </div>
              {responseTab === "headers" || response.binary ? (
                <pre className="response-body">
                  {responseTab === "headers"
                    ? response.headers
                        .map(([name, value]) => `${name}: ${value}`)
                        .join("\n")
                    : response.body}
                </pre>
              ) : (
                <JsonResponse body={response.body} formatted={pretty} />
              )}
            </>
          )}
        </div>
      )}
    </ToolLayout>
  );
}
