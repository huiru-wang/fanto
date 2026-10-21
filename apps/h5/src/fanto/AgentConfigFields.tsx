import type { AgentConfig } from "../api/fanto";

const options: { key: keyof AgentConfig; title: string; description: string }[] = [
  { key: "recordReadEnabled", title: "读取我的记录", description: "允许角色按需读取你的现实记录及其中的媒体。" },
  { key: "fantoMemoryEnabled", title: "开启长期记忆能力", description: "角色自主记忆：保存自己的经历、关系与待续话题，其他角色无法读取。" },
  { key: "narrationEnabled", title: "动作与旁白", description: "允许角色描写动作和环境，关闭时以直接对话为主。" },
];
export function AgentConfigFields({ value, onChange, disabled = false }: {
  value: AgentConfig;
  onChange: (value: AgentConfig) => void;
  disabled?: boolean;
}) {
  return <fieldset className="fanto-capabilities" disabled={disabled}>
    <legend>对话能力</legend>
    <p>每个角色拥有自己的记忆。以下授权仅对这个角色生效。</p>
    {options.map(option => <label className="fanto-capability" key={option.key}>
      <span><strong>{option.title}</strong><small>{option.description}</small></span>
      <input type="checkbox" checked={value[option.key]}
        onChange={event => onChange({ ...value, [option.key]: event.target.checked })} />
    </label>)}
  </fieldset>;
}
