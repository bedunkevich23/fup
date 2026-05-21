import { handleApiRequest } from "../server/index.js";

export default function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const apiPath = url.searchParams.get("path") || "";
  url.searchParams.delete("path");
  req.url = `/api/${apiPath}${url.search}`;
  return handleApiRequest(req, res);
}
