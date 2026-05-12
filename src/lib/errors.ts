export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly body?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
  }
}

export class LimitReachedError extends HttpError {
  constructor(featureKey: string, limit: number, current: number) {
    super(403, `Limit reached for ${featureKey}`, { error: `Limit reached for ${featureKey}`, feature: featureKey, limit, current });
  }
}

export class FeatureNotAvailableError extends HttpError {
  constructor(featureKey: string, planSlug: string) {
    super(403, `Feature not available on current plan`, { error: "Feature not available on current plan", feature: featureKey, plan: planSlug });
  }
}

export class PlanNotFoundError extends HttpError {
  constructor(identifier: string) {
    super(404, `Plan not found: ${identifier}`, { error: "Plan not found", identifier });
  }
}

export class PlanInUseError extends HttpError {
  constructor(planId: string) {
    super(409, `Plan is referenced by existing users`, { error: "Plan is in use and cannot be deleted", planId });
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, message, { error: message, ...(details ?? {}) });
  }
}

export class NotAuthorizedError extends HttpError {
  constructor(message = "Not authorized") {
    super(403, message, { error: message });
  }
}
