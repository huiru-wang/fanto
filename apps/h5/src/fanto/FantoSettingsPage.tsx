import { useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { ApiError } from "../api/http";
import { getFantoSettings, patchFantoSettings, rebaseText, textChanges, type FantoSettings, type RoleConfig } from "../api/fanto";
import { FantoAvatar } from "./FantoAvatar";
import { useFanto } from "./FantoContext";
import { AvatarCropper } from "./AvatarCropper";
const fields: [
    keyof RoleConfig,
    string,
    string
][] = [["character", "角色与性格", "身份、性格与表达风格；留空使用默认风格"], ["scenario", "互动场景", "关系、场景或世界观"], ["instructions", "交流规则", "希望遵循的规则与边界"], ["exampleDialogues", "示例对话", "用几段对话示范交流方式"]];
export function FantoSettingsPage() {
    const profile = useFanto(), navigate = useNavigate();
    const [base, setBase] = useState<FantoSettings | null>(null), [draft, setDraft] = useState<FantoSettings | null>(null), [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflicts, setConflicts] = useState<string[]>([]);
    const input = useRef<HTMLInputElement>(null), saving = useRef(false), returnFocus = useRef<HTMLButtonElement>(null);
    useEffect(() => { if (!base && profile.settings) {
        setBase(profile.settings);
        setDraft(structuredClone(profile.settings));
    } }, [base, profile.settings]);
    const dirty = !!(base && draft && Object.keys(textChanges(base, draft)).length);
    const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || busy || file !== null) && currentLocation.pathname !== nextLocation.pathname);
    useEffect(() => { if (blocker.state !== "blocked")
        return; if (busy || file) {
        blocker.reset();
        return;
    } if (window.confirm("放弃未保存的文字设置？头像保存后已独立生效。"))
        blocker.proceed();
    else
        blocker.reset(); }, [blocker, busy, file]);
    useEffect(() => { if (!dirty && !busy && !file)
        return; const handler = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty, busy, file]);
    const accept = (value: FantoSettings, keepDraft: boolean) => { if (base && draft && keepDraft) {
        const rebased = rebaseText(base, draft, value);
        setDraft(rebased.draft);
        setConflicts(old => [...new Set([...old, ...rebased.conflicts])]);
    }
    else {
        setDraft(structuredClone(value));
        setConflicts([]);
    } setBase(value); profile.accept(value); };
    const commitAvatar = async (id: string | null) => {
        if (!base || saving.current)
            throw new Error("请等待当前操作结束");
        saving.current = true;
        setBusy(true);
        setError("");
        try {
            let response: FantoSettings;
            try {
                response = await patchFantoSettings(base.version, { avatarMediaId: id });
            }
            catch (cause) {
                const remote = await getFantoSettings();
                accept(remote, true);
                if (remote.avatarMediaId !== id)
                    throw new Error(cause instanceof ApiError && cause.code === "VERSION_CONFLICT" ? "远端设置已更新。已保留构图，再次点击保存将更新远端当前头像。" : "保存尚未确认，请重试；已保留上传结果。");
                response = remote;
            }
            accept(response, true);
            setFile(null);
            requestAnimationFrame(() => returnFocus.current?.focus());
        }
        finally {
            saving.current = false;
            setBusy(false);
        }
    };
    const saveText = async () => { if (!base || !draft || saving.current)
        return; saving.current = true; setBusy(true); setError(""); try {
        accept(await patchFantoSettings(base.version, textChanges(base, draft)), false);
        setError("已保存，角色设置从下一轮主对话生效。");
    }
    catch (cause) {
        try {
            const remote = await getFantoSettings();
            const desired = textChanges(base, draft), actual = textChanges(remote, { ...remote, ...desired, roleConfig: { ...remote.roleConfig, ...desired.roleConfig } });
            if (!Object.keys(actual).length)
                accept(remote, false);
            else {
                accept(remote, true);
                setError("远端设置已更新或保存未确认，草稿仍保留，请核对后再次保存。");
            }
        }
        catch {
            setError(cause instanceof Error ? cause.message : "保存失败，草稿已保留");
        }
    }
    finally {
        saving.current = false;
        setBusy(false);
    } };
    if (!base || !draft)
        return <section className="fanto-settings-page"><h1>Fanto 设置</h1><p role="status">{profile.loading ? "正在读取设置…" : profile.error}</p><button onClick={() => void profile.refresh()} disabled={profile.loading}>重新读取</button></section>;
    return <><section className="fanto-settings-page" inert={!!file}>
  <header><button type="button" disabled={busy} onClick={() => { navigate("/chat"); }}>返回</button><h1>Fanto 设置</h1><button className="provider-action" disabled={busy || !dirty || conflicts.length > 0} onClick={() => void saveText()}>{busy ? "保存中…" : "保存"}</button></header>
  <div className="fanto-settings-identity"><button ref={returnFocus} className="avatar-picker" type="button" aria-label="选择新的 Fanto 头像" disabled={busy} onClick={() => input.current?.click()}><FantoAvatar size={88}/></button><strong>{draft.nickname}</strong><p>{draft.description}</p><small>点击头像选择图片，裁剪保存后立即生效</small><input ref={input} type="file" hidden accept="image/*" onChange={e => { const next = e.target.files?.[0]; e.target.value = ""; if (next)
        setFile(next); }}/>{base.avatarMediaId && <button type="button" disabled={busy} onClick={() => void commitAvatar(null).catch(e => setError(e.message))}>恢复默认头像</button>}</div>
  <label className="settings-field">昵称<input value={draft.nickname} disabled={busy} onChange={e => setDraft({ ...draft, nickname: e.target.value })}/></label>
  <label className="settings-field">简介<textarea rows={3} value={draft.description} disabled={busy} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
  {fields.map(([key, label, placeholder]) => <label className="settings-field" key={key}>{label}<textarea rows={key === "exampleDialogues" ? 8 : 5} maxLength={16000} placeholder={placeholder} value={draft.roleConfig[key]} disabled={busy} onChange={e => setDraft({ ...draft, roleConfig: { ...draft.roleConfig, [key]: e.target.value } })}/></label>)}
  {conflicts.length > 0 && <div role="alert"><p>部分文字在其他地方也有修改，请选择保留哪一份。</p><button onClick={() => { setDraft(structuredClone(base)); setConflicts([]); }}>使用远端文字</button><button onClick={() => setConflicts([])}>保留我的文字，稍后保存</button></div>}
  {error && <p role="status">{error}</p>}<p className="fanto-settings-note">文字修改需点击页面保存；头像保存后立即生效。</p>
 </section>{file && <AvatarCropper file={file} onCancel={() => { setFile(null); requestAnimationFrame(() => returnFocus.current?.focus()); }} onSave={id => commitAvatar(id)}/>}</>;
}
