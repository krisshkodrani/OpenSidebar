export type HttpEvent = {
  requestContext: { http: { method: string; path: string; sourceIp?: string }; authorizer?: { jwt?: { claims?: Record<string, string> } } };
  headers?: Record<string, string | undefined>;
  /** API Gateway HTTP API payload v2 carries Cookie headers separately. */
  cookies?: string[];
  body?: string | null;
  pathParameters?: Record<string, string | undefined>;
  rawQueryString?: string;
};

export type HttpResponse = { statusCode: number; headers?: Record<string, string>; cookies?: string[]; body: string };
