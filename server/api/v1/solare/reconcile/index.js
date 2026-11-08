import { readRawBody } from "h3";
import { ForbiddenError, ValidationError } from "~~/infra/errors.js";

function assertAuthorizedMaintenanceRequest(event) {
  const authHeader = getHeader(event, "authorization");
  if (solare.verifyCronBearerToken(authHeader)) {
    return;
  }

  if (authorization.can(event.context.user, "run:migrations")) {
    return;
  }

  throw new ForbiddenError({
    message: "You do not have permission to run this action.",
    action:
      'Provide a valid CRON_SECRET bearer token or authenticate with "run:migrations" permission.',
  });
}

async function parseJsonObjectBody(event) {
  const rawText = await readRawBody(event, "utf8");
  if (rawText === undefined || rawText === null || rawText.trim() === "") {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new ValidationError({
      message: "Invalid JSON payload.",
      action: "Provide a valid JSON object in the request body.",
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError({
      message: "Invalid request body.",
      action: "Provide a valid JSON object.",
    });
  }

  return parsed;
}

export default controller.handle({
  get: async (event) => {
    assertAuthorizedMaintenanceRequest(event);
    const query = getQuery(event);
    const isCronBearerRequest = solare.verifyCronBearerToken(
      getHeader(event, "authorization"),
    );

    const summary = await solare.runAutomatedMaintenance({
      region: query.region,
      season: query.season,
      autoClamp:
        query.auto_clamp !== undefined ? query.auto_clamp : isCronBearerRequest,
      applyDecay: query.apply_decay,
    });

    setHeader(event, "Cache-Control", "no-store");
    return summary;
  },
  post: async (event) => {
    assertAuthorizedMaintenanceRequest(event);
    const body = await parseJsonObjectBody(event);

    const summary = await solare.runAutomatedMaintenance({
      region: body.region,
      season: body.season,
      anchors: body.anchors,
      autoClamp: body.auto_clamp,
      applyDecay: body.apply_decay,
      now: body.now,
    });

    setHeader(event, "Cache-Control", "no-store");
    return summary;
  },
});
