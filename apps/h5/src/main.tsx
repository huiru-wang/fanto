import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./app/App";
import { AuthProvider } from "./auth/AuthProvider";
import "./styles/global.css";
import "./auth/auth.css";

createRoot(document.getElementById("root")!).render(
  <AuthProvider><RouterProvider router={createBrowserRouter([{ path: "*", element: <App /> }])} /></AuthProvider>,
);
