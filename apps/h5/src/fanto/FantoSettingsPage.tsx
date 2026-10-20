import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/http";
import { createFanto, emptyFanto, getFanto, patchFanto, type CreateFanto, type FantoSettings, type RoleConfig } from "../api/fanto";
import { FantoAvatar } from "./FantoAvatar";
import { useFanto } from "./FantoContext";
import { AvatarCropper } from "./AvatarCropper";
import { AgentConfigFields } from "./AgentConfigFields";
import { configChanges, fantoLabel, rebaseConfig } from "./settings-state";

const fields: [keyof RoleConfig, string, string][] = [
  ["character", "角色设定", "人物身份、性格、习惯与语言气质；也可以留空"],
  ["scenario", "世界与关系", "世界背景、初始关系和常见互动环境"],
  ["instructions", "交流方式与边界", "互动偏好、表达方式与边界"],
  ["exampleDialogues", "示例对话", "示范语气与节奏，示例不会作为已发生的记忆"],
];
export function FantoSettingsPage({ creating = false }: { creating?: boolean }) {
  const { fantoId } = useParams();
  const profile = useFanto();
  const role = profile.roles.find(item => item.fantoId === fantoId);
  if (!creating && !role) return <section className="fanto-settings-page">
    <h1>角色设置</h1><p role="status">{profile.loading ? "正在读取角色…" : profile.error || "角色不存在或已被删除。"}</p>
    <Link to="/fantos">返回角色列表</Link>
    {profile.error && <button onClick={() => void profile.refresh()}>重试</button>}
  </section>;
  return <FantoEditor key={creating ? "new" : fantoId} role={role ?? null} />;
}
function FantoEditor({ role }: { role: FantoSettings | null }) {
  const profile = useFanto(), navigate = useNavigate();
  const [base, setBase] = useState(role);
  const [draft, setDraft] = useState<CreateFanto>(() => role ? structuredClone(role) : emptyFanto());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [created, setCreated] = useState(false);
  const [creationUncertain, setCreationUncertain] = useState(false);
  const saving = useRef(false), input = useRef<HTMLInputElement>(null);
  const creating = !base;
  const archived = base?.status === "archived";
  const dirty = !created && (base ? Object.keys(configChanges(base.agentConfig, draft.agentConfig)).length > 0
    : JSON.stringify(draft) !== JSON.stringify(emptyFanto()));
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !created && (dirty || busy || file !== null) && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (busy || file) { blocker.reset(); return; }
    if (window.confirm("放弃未保存的设置？")) blocker.proceed(); else blocker.reset();
  }, [blocker, busy, file]);
  useEffect(() => {
    if (!dirty && !busy && !file) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, busy, file]);
  useEffect(() => { if (created && base) { profile.select(base.fantoId); navigate("/chat"); } }, [created, base, profile.select, navigate]);

  const apply = (value: FantoSettings) => { setBase(value); profile.accept(value); };
  const reconcile = async (cause: unknown) => {
    if (!base) return;
    try {
      const remote = await getFanto(base.fantoId);
      const rebased = rebaseConfig(base.agentConfig, draft.agentConfig, remote.agentConfig);
      apply(remote); setDraft(old => ({ ...old, agentConfig: rebased.draft }));
      setNotice(cause instanceof ApiError && cause.code === "FANTO_BUSY" ? "角色正在回复，请等当前对话结束后再保存。"
        : "已读取最新配置，你的修改已保留。请核对后再次保存。");
    } catch { setNotice("保存未确认，修改仍保留，请检查网络后重试。"); }
  };
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setNotice("");
    try {
      if (base) {
        const value = await patchFanto(base.fantoId, base.version, configChanges(base.agentConfig, draft.agentConfig));
        apply(value); setDraft(old => ({ ...old, agentConfig: value.agentConfig })); setNotice("已保存，下一轮对话生效。");
      } else {
        const value = await createFanto(draft);
        apply(value); setCreated(true);
      }
    } catch (cause) {
      if (base) await reconcile(cause);
      else {
        setCreationUncertain(!(cause instanceof ApiError) || cause.status >= 500);
        setNotice(cause instanceof ApiError && cause.code === "FANTO_LIMIT_REACHED" ? "最多使用 3 个活跃角色，请先归档一个角色。"
        : "创建未确认。为避免重复创建，请先返回角色列表刷新核对，再决定是否重试。");
      }
    } finally { saving.current = false; setBusy(false); }
  };
  const commitAvatar = async (id: string | null) => {
    if (saving.current) throw Error("请等待当前保存结束");
    if (!base) { setDraft(old => ({ ...old, avatarMediaId: id })); setFile(null); return; }
    saving.current = true; setBusy(true);
    try {
      let value: FantoSettings;
      try { value = await patchFanto(base.fantoId, base.version, { avatarMediaId: id }); }
      catch (cause) {
        const remote = await getFanto(base.fantoId); apply(remote);
        if (remote.avatarMediaId !== id) throw Error(cause instanceof ApiError && cause.code === "FANTO_BUSY"
          ? "角色正在回复，请稍后再保存头像。" : "头像保存未确认，请核对后重试；上传结果已保留。");
        value = remote;
      }
      apply(value); setDraft(old => ({ ...old, avatarMediaId: id })); setFile(null);
    } finally { saving.current = false; setBusy(false); }
  };
  return <>
    <section className="fanto-settings-page" inert={!!file}>
      <header><Link to="/fantos">返回</Link><h1>{creating ? "创建角色" : "角色设置"}</h1>
        <button className="provider-action" disabled={busy || creationUncertain || archived || (!creating && !dirty) || (creating && profile.roles.filter(item => item.status === "active").length >= 3)}
          onClick={() => void save()}>{busy ? "保存中…" : creating ? "创建角色" : "保存配置"}</button>
      </header>
      <p className="fanto-settings-note">{creating ? "所有身份字段都可以留空。创建后身份固定，能力和头像可继续调整。" : "身份已固定。需要不同的人物设定时，请创建一个新角色。"}</p>
      {archived && <p role="status">这个角色已归档。恢复后可以继续配置和对话。</p>}
      <div className="fanto-settings-identity">
        <button className="avatar-picker" type="button" aria-label="选择角色头像" disabled={busy || archived} onClick={() => input.current?.click()}>
          <FantoAvatar size={88} avatarMediaId={draft.avatarMediaId ?? null} label={draft.nickname || "未命名角色"} />
        </button><strong>{draft.nickname || "未命名角色"}</strong>
        <small>{creating ? "头像随角色一起创建" : "点击头像裁切并独立保存"}</small>
        <input ref={input} type="file" hidden accept="image/*" onChange={event => {
          const next = event.target.files?.[0]; event.target.value = ""; if (next) setFile(next);
        }} />
        {draft.avatarMediaId && <button disabled={busy || archived} onClick={() => void commitAvatar(null).catch(cause => setNotice(cause.message))}>恢复默认头像</button>}
      </div>
      <label className="settings-field">角色名称<input maxLength={30} value={draft.nickname} readOnly={!creating} disabled={busy}
        onChange={event => setDraft({ ...draft, nickname: event.target.value })} placeholder="可留空" /></label>
      <label className="settings-field">简介<textarea maxLength={300} rows={3} value={draft.description} readOnly={!creating} disabled={busy}
        onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="可留空" /></label>
      {fields.map(([key, title, placeholder]) => <label className="settings-field" key={key}>{title}
        <textarea rows={key === "exampleDialogues" ? 6 : 4} maxLength={16000} value={draft.roleConfig[key]}
          readOnly={!creating} disabled={busy} placeholder={placeholder}
          onChange={event => setDraft({ ...draft, roleConfig: { ...draft.roleConfig, [key]: event.target.value } })} />
      </label>)}
      <AgentConfigFields value={draft.agentConfig} disabled={busy || archived}
        onChange={agentConfig => setDraft(old => ({ ...old, agentConfig }))} />
      {notice && <p role="status" className="fanto-notice">{notice}</p>}
    </section>
    {file && <AvatarCropper file={file} onCancel={() => setFile(null)} onSave={commitAvatar} />}
  </>;
}
