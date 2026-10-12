import { runVercelRoute } from '../_lib/runtime.mjs';

export default function handler(request, response) {
  return runVercelRoute(request, response, '/api/admin/invite');
}
