import {
  Controller,
  Endpoint,
  json,
  type RequestSpec,
  type ResponseSpec,
} from '@di-framework/http';
import openapiDoc from '../../data/openapi.json';
import { router } from '../router';

@Controller()
export class OpenApiController {
  @Endpoint({
    summary: 'OpenAPI Specification',
    description: 'Returns the OpenAPI 3.1.0 specification for the search service.',
    responses: {
      '200': { description: 'OpenAPI 3.1.0 document' },
    },
  })
  static get = router.get<RequestSpec, ResponseSpec<typeof openapiDoc>>(
    '/openapi.json',
    async () => json(openapiDoc)
  );
}
