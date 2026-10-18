import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./app/App";
import { initializeTestSession } from "./auth/test-session";
import "./styles/global.css";

const root = createRoot(document.getElementById("root")!);

void initializeTestSession()
  .then(() => {
    root.render(
      <RouterProvider router={createBrowserRouter([{path:"*",element:<App />}])}/>,
    );
  })
  .catch(cause => {
    const message = cause instanceof Error ? cause.message : "测试会话初始化失败";
    root.render(<main className="app-shell"><div className="empty-state"><p>{message}</p></div></main>);
  });
