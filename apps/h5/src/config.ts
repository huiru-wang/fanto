export const FANTO_AGENT_ID = "main";
export const H5_TEST_AUTH_ENABLED = import.meta.env.VITE_H5_TEST_AUTH === "true";
export const H5_TEST_REFRESH_TOKEN = import.meta.env.VITE_H5_TEST_REFRESH_TOKEN?.trim() ?? "";

export const AGENT_SESSION_KEY = `fanto.h5.agent.session.test.${FANTO_AGENT_ID}`;
