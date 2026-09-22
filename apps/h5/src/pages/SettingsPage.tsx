import {
  Bell,
  ChevronRight,
  CircleUserRound,
  Download,
  LogOut,
  Moon,
  Palette,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

type FantoPersonality = "quiet" | "lively";
type Appearance = "system" | "light" | "dark";
type LoginProvider = "phone" | "google" | "apple" | "email";
type Accent = "default" | "orange" | "blue" | "green" | "purple";

const providerLabel: Record<LoginProvider, string> = {
  phone: "手机号",
  google: "Google",
  apple: "Apple",
  email: "邮箱",
};

const accents: Array<{ id: Accent; label: string; swatch: string }> = [
  { id: "default", label: "默认", swatch: "#272723" },
  { id: "orange", label: "暖橙", swatch: "#b66e45" },
  { id: "blue", label: "雾蓝", swatch: "#55758a" },
  { id: "green", label: "苔绿", swatch: "#657764" },
  { id: "purple", label: "淡紫", swatch: "#7a6d87" },
];

export function SettingsPage() {
  const [displayName, setDisplayName] = useState("Robin");
  const [birthday, setBirthday] = useState("未设置");
  const [personality, setPersonality] = useState<FantoPersonality>("quiet");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState("23:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [language, setLanguage] = useState("简体中文");
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [accent, setAccent] = useState<Accent>("default");
  const [profileOpen, setProfileOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [personalityOpen, setPersonalityOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [generalOpen, setGeneralOpen] = useState<"language" | "appearance" | "accent" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [bound, setBound] = useState<Record<LoginProvider, string | null>>({
    phone: "138 **** 1234",
    google: "robin@gmail.com",
    apple: null,
    email: "robin@example.com",
  });

  const personalityLabel = personality === "quiet" ? "安静" : "活泼";
  const appearanceLabel = appearance === "system" ? "跟随系统" : appearance === "light" ? "浅色" : "深色";
  const accentLabel = useMemo(() => accents.find(item => item.id === accent)?.label ?? "默认", [accent]);

  const bindProvider = (provider: LoginProvider) => {
    const demoValue: Record<LoginProvider, string> = {
      phone: "186 **** 6088",
      google: "new.account@gmail.com",
      apple: "r***@privaterelay.appleid.com",
      email: "hello@example.com",
    };
    setBound(current => ({ ...current, [provider]: current[provider] ? null : demoValue[provider] }));
  };

  return (
    <div className="settings-page">
      <div className="settings-wrap">
        <header className="settings-header">
          <p className="eyebrow">Settings</p>
          <h1>设置</h1>
          <p>管理你的个人资料、Fanto 性格和应用偏好。</p>
        </header>

        <button className="settings-profile-card" onClick={() => setProfileOpen(true)}>
          <span className="settings-avatar"><UserRound size={28} strokeWidth={1.7} /></span>
          <span className="settings-profile-copy">
            <strong>{displayName}</strong>
            <small>个人资料</small>
          </span>
          <ChevronRight size={18} />
        </button>

        <SettingsSection title="个人">
          <SettingsRow icon={<CircleUserRound size={18} />} title="个人资料" value={displayName} onClick={() => setProfileOpen(true)} />
          <SettingsRow icon={<ShieldCheck size={18} />} title="账号与登录" value="3 个已绑定" onClick={() => setLoginOpen(true)} />
        </SettingsSection>

        <SettingsSection title="Fanto">
          <SettingsRow icon={<Sparkles size={18} />} title="性格" value={personalityLabel} onClick={() => setPersonalityOpen(true)} />
        </SettingsSection>

        <SettingsSection title="通知">
          <SettingsRow
            icon={<Bell size={18} />}
            title="通知"
            value={notificationsEnabled ? "开启" : "关闭"}
            onClick={() => setNotificationOpen(true)}
          />
        </SettingsSection>

        <SettingsSection title="通用">
          <SettingsRow icon={<Settings2 size={18} />} title="语言" value={language} onClick={() => setGeneralOpen("language")} />
          <SettingsRow icon={appearance === "dark" ? <Moon size={18} /> : <Sun size={18} />} title="外观" value={appearanceLabel} onClick={() => setGeneralOpen("appearance")} />
          <SettingsRow icon={<Palette size={18} />} title="强调色" value={accentLabel} onClick={() => setGeneralOpen("accent")} />
        </SettingsSection>

        <SettingsSection title="数据与隐私">
          <SettingsRow
            icon={<Download size={18} />}
            title="导出我的数据"
            value={exporting ? "准备中…" : undefined}
            onClick={() => {
              setExporting(true);
              window.setTimeout(() => setExporting(false), 1300);
            }}
          />
        </SettingsSection>

        <button className="logout-button" onClick={() => setLogoutOpen(true)}>
          <LogOut size={18} />
          <span>退出登录</span>
        </button>

        <p className="settings-demo-note">当前页面为产品交互原型，所有修改仅保留在当前页面状态。</p>
      </div>

      <SettingsModal title="个人资料" open={profileOpen} onClose={() => setProfileOpen(false)}>
        <div className="profile-avatar-large"><UserRound size={34} strokeWidth={1.6} /></div>
        <button className="text-action" type="button">更换头像</button>
        <Field label="昵称">
          <input value={displayName} onChange={event => setDisplayName(event.target.value)} />
        </Field>
        <Field label="生日">
          <input type="date" value={birthday === "未设置" ? "" : birthday} onChange={event => setBirthday(event.target.value || "未设置")} />
        </Field>
      </SettingsModal>

      <SettingsModal title="账号与登录" open={loginOpen} onClose={() => setLoginOpen(false)}>
        <p className="modal-description">已绑定的方式可以直接登录；未绑定的可以在这里完成绑定。</p>
        <div className="login-provider-list">
          {(Object.keys(providerLabel) as LoginProvider[]).map(provider => (
            <div className="login-provider" key={provider}>
              <div>
                <strong>{providerLabel[provider]}</strong>
                <span>{bound[provider] ?? "未绑定"}</span>
              </div>
              <button
                className={bound[provider] ? "provider-action subtle" : "provider-action"}
                onClick={() => bindProvider(provider)}
              >
                {bound[provider] ? "解绑" : "绑定"}
              </button>
            </div>
          ))}
        </div>
      </SettingsModal>

      <SettingsModal title="Fanto 性格" open={personalityOpen} onClose={() => setPersonalityOpen(false)}>
        <p className="modal-description">这会影响 Fanto 和你交流时的表达方式，不改变它对事实和记录的理解。</p>
        <ChoiceCard
          selected={personality === "quiet"}
          title="安静"
          description="平静、克制，回答更简洁自然。"
          onClick={() => setPersonality("quiet")}
        />
        <ChoiceCard
          selected={personality === "lively"}
          title="活泼"
          description="更有表达欲，语气更轻松，也会适当开玩笑。"
          onClick={() => setPersonality("lively")}
        />
      </SettingsModal>

      <SettingsModal title="通知" open={notificationOpen} onClose={() => setNotificationOpen(false)}>
        <ToggleRow title="允许通知" checked={notificationsEnabled} onChange={setNotificationsEnabled} />
        <div className={notificationsEnabled ? "" : "settings-disabled"}>
          <ToggleRow title="安静时段" checked={quietHoursEnabled} onChange={setQuietHoursEnabled} />
          {quietHoursEnabled && (
            <div className="quiet-hours-grid">
              <Field label="开始">
                <input type="time" value={quietStart} onChange={event => setQuietStart(event.target.value)} />
              </Field>
              <Field label="结束">
                <input type="time" value={quietEnd} onChange={event => setQuietEnd(event.target.value)} />
              </Field>
            </div>
          )}
        </div>
      </SettingsModal>

      <SettingsModal title="语言" open={generalOpen === "language"} onClose={() => setGeneralOpen(null)}>
        {["跟随系统", "简体中文", "English"].map(item => (
          <ChoiceCard key={item} selected={language === item} title={item} onClick={() => setLanguage(item)} />
        ))}
      </SettingsModal>

      <SettingsModal title="外观" open={generalOpen === "appearance"} onClose={() => setGeneralOpen(null)}>
        <ChoiceCard selected={appearance === "system"} title="跟随系统" onClick={() => setAppearance("system")} />
        <ChoiceCard selected={appearance === "light"} title="浅色" onClick={() => setAppearance("light")} />
        <ChoiceCard selected={appearance === "dark"} title="深色" onClick={() => setAppearance("dark")} />
      </SettingsModal>

      <SettingsModal title="强调色" open={generalOpen === "accent"} onClose={() => setGeneralOpen(null)}>
        <div className="accent-grid">
          {accents.map(item => (
            <button
              key={item.id}
              className={`accent-choice ${accent === item.id ? "selected" : ""}`}
              onClick={() => setAccent(item.id)}
            >
              <span style={{ background: item.swatch }} />
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>
      </SettingsModal>

      <SettingsModal title="退出登录？" open={logoutOpen} onClose={() => setLogoutOpen(false)}>
        <p className="modal-description">退出后，你仍可以使用已绑定的登录方式重新登录。本原型不会真的退出账号。</p>
        <div className="modal-actions">
          <button className="secondary-button" onClick={() => setLogoutOpen(false)}>取消</button>
          <button className="danger-button" onClick={() => setLogoutOpen(false)}>退出登录</button>
        </div>
      </SettingsModal>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function SettingsRow({
  icon,
  title,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button className="settings-row" onClick={onClick}>
      <span className="settings-row-icon">{icon}</span>
      <span className="settings-row-title">{title}</span>
      {value && <span className="settings-row-value">{value}</span>}
      <ChevronRight size={17} className="settings-row-chevron" />
    </button>
  );
}

function SettingsModal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="settings-modal-backdrop" onMouseDown={onClose}>
      <div className="settings-modal" onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="settings-modal-header">
          <strong>{title}</strong>
          <button onClick={onClose} aria-label="关闭">完成</button>
        </div>
        <div className="settings-modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ChoiceCard({
  selected,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button className={`choice-card ${selected ? "selected" : ""}`} onClick={onClick}>
      <span className="choice-radio">{selected && <i />}</span>
      <span>
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
    </button>
  );
}

function ToggleRow({
  title,
  checked,
  onChange,
}: {
  title: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <strong>{title}</strong>
      <button
        type="button"
        className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span />
      </button>
    </div>
  );
}
