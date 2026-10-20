import { type Env, handle } from "./handler";

/** StormX data Worker: the stormx-data bucket on workers.dev, read-only, CORS locked to the site. */
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
