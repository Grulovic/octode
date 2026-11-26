import { useRef, useState, type PointerEvent } from "react";
import { Copy, Eye, EyeOff, GripVertical, LockKeyhole, ArrowUp, ArrowDown } from "lucide-react";
import { Plus, Save, Pencil, Trash2 } from "./DesignIcons";
import { useVaults } from "./VaultProvider";
import { moveVaultItem, vaultUrl, type VaultKind, type VaultItem } from "../lib/vaults";
import { desktop, invoke } from "../lib/bridge";
import { copyTextToClipboard } from "../lib/clipboard";
import CustomSelect from "./CustomSelect";
import PanelResize, { usePanelSize } from "./PanelResize";
import "./vault.css";
const kinds: [VaultKind, string][] = [["section", "Section title"], ["url", "URL"], ["value", "Value"], ["password", "Password"], ["note", "Note"]];
export default function VaultWorkspace() {
  const vault = useVaults();
  const doc = vault.doc;
  const sidebar = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [width, setWidth] = usePanelSize("octode-layout:vault-sidebar", 280);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<VaultKind>("value");
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const drag = useRef<{ id: string; target: string; after: boolean } | null>(null);
  const updateItems = (items: VaultItem[]) => { if (doc) vault.update({ ...doc, items }); };
  const patch = (id: string, patch: Partial<VaultItem>) => updateItems(doc!.items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const move = (id: string, offset: number) => {
    if (!doc) return;
    const index = doc.items.findIndex((item) => item.id === id); const target = doc.items[index + offset];
    if (target) updateItems(moveVaultItem(doc.items, id, target.id, offset > 0));
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag.current) return;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-vault-item]");
    if (!row || !list.current?.contains(row)) { drag.current.target = ""; setDrop(null); return; }
    const after = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    drag.current.target = row.dataset.vaultItem!; drag.current.after = after;
    setDrop({ id: drag.current.target, after });
    const bounds = list.current!.getBoundingClientRect();
    if (event.clientY < bounds.top + 40) list.current!.scrollTop -= 16;
    if (event.clientY > bounds.bottom - 40) list.current!.scrollTop += 16;
  };
  const copy = async (item: VaultItem) => {
    try { await copyTextToClipboard(item.value); setMessage(`${item.label || "Value"} copied`); } catch { setMessage("Could not copy to clipboard"); }
  };
  const select = (meta: Parameters<typeof vault.select>[0]) => { setRevealed({}); setMessage(""); void vault.select(meta); };
  const vaultButton = (meta: Parameters<typeof vault.select>[0]) => <button key={meta.id} className={`vault-select ${vault.active === meta.id ? "selected" : ""}`} disabled={vault.saving} onClick={() => select(meta)}><LockKeyhole size={14}/><span>{meta.name}</span>{vault.isDirty(meta.id) && <span className="tool-unsaved-dot" aria-label="Unsaved vault"/>}</button>;
  return <div className="vault-workspace">
    <aside className="vault-sidebar" ref={sidebar} style={{ width }}>
      <header><strong>Vaults</strong><button className="icon-button" aria-label="Create custom vault" title="Create custom vault" disabled={vault.saving} onClick={vault.create}><Plus size={15}/></button></header>
      <div className="vault-catalog"><h3>Projects</h3>{vault.projectVaults.map(vaultButton)}<h3>Custom vaults</h3>{vault.customVaults.map(vaultButton)}{!vault.customVaults.length && <p className="vault-hint">Create a vault for shared information.</p>}</div>
    </aside>
    <PanelResize target={sidebar} size={width} onResize={setWidth} minSize={190} minRemainingSize={360} label="Resize vault sidebar"/>
    <section className="vault-main">
      {vault.error && <div className="error-banner" role="alert">{vault.error}</div>}
      {vault.loading ? <div className="notes-empty">Opening vault…</div> : !doc ? <div className="notes-empty"><LockKeyhole size={32}/><h2>Your important details, together.</h2><p>Select a project vault or create a custom vault.</p><button className="secondary-button" onClick={vault.create}><Plus size={14}/>New vault</button></div> : <>
        <header>{vault.editing && !doc.projectId ? <input aria-label="Vault name" maxLength={100} value={doc.name} disabled={vault.saving} onChange={(e) => vault.update({ ...doc, name: e.target.value })}/> : <strong>{vault.projectVaults.find((item) => item.id === doc.id)?.name ?? doc.name}</strong>}
          <span className="vault-save-state">{vault.saving ? "Saving…" : vault.isDirty(doc.id) ? "Unsaved changes" : "Saved"}</span>
          {vault.editing ? <><button className="secondary-button" disabled={vault.saving} onClick={() => void vault.discard()}>Discard</button><button className="primary-button" disabled={vault.saving || !doc.name.trim()} onClick={() => { setRevealed({}); void vault.save(); }}><Save size={14}/>Save</button></> : <button className="secondary-button" onClick={vault.edit}><Pencil size={14}/>Edit</button>}
          {!vault.projectVaults.some((item) => item.id === doc.id) && <button className="icon-button" aria-label="Delete vault" disabled={vault.saving} onClick={() => void vault.remove()}><Trash2 size={14}/></button>}
        </header>
        {vault.editing && <div className="vault-toolbar"><CustomSelect aria-label="New item type" value={kind} disabled={vault.saving} onChange={(e) => setKind(e.target.value as VaultKind)}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</CustomSelect><button className="secondary-button" disabled={vault.saving} onClick={() => updateItems([...doc.items, { id: crypto.randomUUID(), kind, label: "", value: "" }])}><Plus size={14}/>Add item</button><span>Drag the handle to reorder</span></div>}
        <div className="vault-items" ref={list} key={doc.id}>
          {!doc.items.length && <div className="vault-hint">{vault.editing ? "Choose an item type and add your first item." : "This vault is empty. Click Edit to add details."}</div>}
          {doc.items.map((item, index) => <article key={item.id} data-vault-item={item.id} className={`vault-item vault-item-${item.kind} ${drop?.id === item.id ? drop.after ? "drop-after" : "drop-before" : ""}`}>
            {vault.editing && <button className="vault-drag icon-button" aria-label={`Drag item ${index + 1}`} disabled={vault.saving} onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: item.id, target: "", after: false }; }} onPointerMove={pointerMove} onPointerUp={(e) => { if (drag.current?.target) updateItems(moveVaultItem(doc.items, drag.current.id, drag.current.target, drag.current.after)); drag.current = null; setDrop(null); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { drag.current = null; setDrop(null); }} onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); move(item.id, e.key === "ArrowUp" ? -1 : 1); } }}><GripVertical size={16}/></button>}
            <div className="vault-item-content">{vault.editing ? <>
              <label><span>{kinds.find(([kind]) => kind === item.kind)?.[1]}{item.kind !== "section" && " label"}</span><input aria-label={`Item ${index + 1} label`} maxLength={200} value={item.label} disabled={vault.saving} onChange={(e) => patch(item.id, { label: e.target.value })}/></label>
              {item.kind !== "section" && <label><span>{item.kind === "note" ? "Text" : "Content"}</span>{item.kind === "note" ? <textarea aria-label={`Item ${index + 1} content`} rows={4} value={item.value} disabled={vault.saving} spellCheck={false} onChange={(e) => patch(item.id, { value: e.target.value })}/> : <input aria-label={`Item ${index + 1} content`} type={item.kind === "password" && !revealed[item.id] ? "password" : "text"} value={item.value} autoComplete="off" autoCorrect="off" spellCheck={false} disabled={vault.saving} onChange={(e) => patch(item.id, { value: e.target.value })}/>}</label>}
            </> : item.kind === "section" ? <h2>{item.label || "Untitled section"}</h2> : <><div className="vault-item-label">{item.label || kinds.find(([kind]) => kind === item.kind)?.[1]}</div>{item.kind === "note" ? <p>{item.value}</p> : item.kind === "url" && vaultUrl(item.value) ? <a href={vaultUrl(item.value)!} target="_blank" rel="noreferrer" onClick={(e) => { if (desktop) { e.preventDefault(); void invoke("open_terminal_url", { url: vaultUrl(item.value) }).catch(() => setMessage("Could not open URL")); } }}>{item.value}</a> : <div className={item.kind === "password" ? "vault-password" : "vault-value"}>{item.kind === "password" && !revealed[item.id] ? "••••••••••••" : item.value || "—"}</div>}</>}
            </div>
            <div className="vault-item-actions">{item.kind === "password" && <button className="icon-button" aria-label={revealed[item.id] ? "Hide password" : "Show password"} title={revealed[item.id] ? "Hide password" : "Show password"} onClick={() => setRevealed((old) => ({ ...old, [item.id]: !old[item.id] }))}>{revealed[item.id] ? <EyeOff size={15}/> : <Eye size={15}/>}</button>}{!vault.editing && ["url", "value", "password"].includes(item.kind) && <button className="icon-button" aria-label={`Copy ${item.label || item.kind}`} title="Copy" onClick={() => void copy(item)}><Copy size={15}/></button>}{vault.editing && <><button className="icon-button" aria-label={`Move item ${index + 1} up`} disabled={vault.saving || index === 0} onClick={() => move(item.id, -1)}><ArrowUp size={13}/></button><button className="icon-button" aria-label={`Move item ${index + 1} down`} disabled={vault.saving || index === doc.items.length - 1} onClick={() => move(item.id, 1)}><ArrowDown size={13}/></button><button className="icon-button" aria-label={`Remove item ${index + 1}`} disabled={vault.saving} onClick={() => updateItems(doc.items.filter((row) => row.id !== item.id))}><Trash2 size={14}/></button></>}</div>
          </article>)}
        </div>
        <footer><span>{doc.items.length} items · {doc.projectId ? "Project vault" : "Custom vault"}</span><span role="status">{message}</span></footer>
      </>}
    </section>
  </div>;
}
