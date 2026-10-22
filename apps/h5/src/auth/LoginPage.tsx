import { GoogleSignInButton } from "./GoogleSignInButton";
export function LoginPage() {
  return <main className="auth-page"><div className="auth-center">
    <img className="auth-sprite" alt="Fanto 品牌精灵" src="/assets/fanto/auth/login.webp" />
    <h1>一个懂你的世界，从这里开始</h1>
    <p className="auth-subtitle">与你的 Fanto，一起探索更多故事</p>
    <GoogleSignInButton />
  </div></main>;
}
