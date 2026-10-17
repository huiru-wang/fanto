import { useEffect, useRef, useState } from "react";
import { getCharacter, saveCharacter, type CharacterPrompt } from "../api/character";

const fields: Array<{ key: keyof CharacterPrompt; label: string; placeholder: string }> = [
  { key: "character", label: "角色与性格", placeholder: "身份、性格、表达风格；留空使用默认交流风格" },
  { key: "scenario", label: "互动场景", placeholder: "你们的关系、交流场景或世界观" },
  { key: "instructions", label: "交流规则", placeholder: "希望遵循的规则与偏好" },
  { key: "exampleDialogues", label: "示例对话", placeholder: "用几段对话展示期望的交流方式" },
];

export function CharacterSettings({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<CharacterPrompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    if (!saving) closeButton.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [saving, onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getCharacter(controller.signal).then(value => {
      if (!controller.signal.aborted) setConfig(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError("读取角色设定失败，请重试。");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  return (
    <div className="settings-modal-backdrop" onKeyDown={event => {
      if (event.key === "Tab") {
        const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled)");
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="character-settings-title" aria-busy={loading || saving}>
        <div className="settings-modal-header">
          <strong id="character-settings-title">角色设定</strong>
          <button ref={closeButton} type="button" onClick={onClose} disabled={saving}>关闭</button>
        </div>
        <form className="settings-modal-body" onSubmit={async event => {
          event.preventDefault();
          if (!config || saving) return;
          setSaving(true);
          setSaved(false);
          setError("");
          try {
            setConfig(await saveCharacter(config));
            setSaved(true);
          } catch {
            setError("保存失败，内容仍保留在编辑框中，请重试。");
          } finally {
            setSaving(false);
          }
        }}>
          <p className="modal-description">设定 Fanto 的角色、场景与交流方式。保存后，从主对话的下一轮回复开始生效，无需新建会话。</p>
          {loading && <p role="status">正在读取角色设定…</p>}
          {error && <p role="alert">{error}</p>}
          {!loading && !config && <button className="secondary-button" type="button" onClick={() => setAttempt(value => value + 1)}>重新读取</button>}
          {config && fields.map(field => (
            <label className="settings-field" key={field.key}>
              <span>{field.label}</span>
              <textarea rows={4} maxLength={16000} value={config[field.key]} placeholder={field.placeholder} disabled={saving}
                onChange={event => { setConfig({ ...config, [field.key]: event.target.value }); setSaved(false); }} />
            </label>
          ))}
          {saved && <p role="status">已保存，主对话下一轮生效。</p>}
          <div className="modal-actions">
            <button className="secondary-button" type="button" disabled={saving} onClick={onClose}>关闭</button>
            <button className="provider-action" type="submit" disabled={loading || saving || !config}>{saving ? "保存中…" : "保存设定"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
