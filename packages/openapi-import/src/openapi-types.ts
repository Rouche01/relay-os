/** Minimal OpenAPI 3.x shapes used by the importer (not a full OAS model). */

export type JsonSchemaLike = {
  type?: string | string[];
  format?: string;
  description?: string;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  items?: JsonSchemaLike;
  $ref?: string;
  allOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  anyOf?: JsonSchemaLike[];
  [key: string]: unknown;
};

export type OpenApiParameter = {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchemaLike;
  $ref?: string;
};

export type OpenApiRequestBody = {
  description?: string;
  required?: boolean;
  content?: Record<string, { schema?: JsonSchemaLike }>;
  $ref?: string;
};

export type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  security?: Array<Record<string, string[]>>;
  [key: string]: unknown;
};

export type OpenApiPathItem = {
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  put?: OpenApiOperation;
  post?: OpenApiOperation;
  delete?: OpenApiOperation;
  options?: OpenApiOperation;
  head?: OpenApiOperation;
  patch?: OpenApiOperation;
  $ref?: string;
  [key: string]: unknown;
};

export type OpenApiSecurityScheme = {
  type?: string;
  name?: string;
  in?: string;
  scheme?: string;
  description?: string;
  flows?: unknown;
  $ref?: string;
};

export type OpenApiServer = {
  url: string;
  description?: string;
  variables?: Record<string, { default?: string; enum?: string[] }>;
};

export type OpenApiDocument = {
  openapi?: string;
  swagger?: string;
  info?: {
    title?: string;
    description?: string;
    version?: string;
  };
  servers?: OpenApiServer[];
  paths?: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, JsonSchemaLike>;
    parameters?: Record<string, OpenApiParameter>;
    requestBodies?: Record<string, OpenApiRequestBody>;
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
  security?: Array<Record<string, string[]>>;
};
