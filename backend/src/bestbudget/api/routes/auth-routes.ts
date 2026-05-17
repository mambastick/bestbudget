import type { FastifyInstance } from "fastify"

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/oidc/:provider/start", async (request, reply) => {
    const { provider } = request.params as { provider: string }

    return reply.code(501).send({
      error: "oidc_provider_not_configured",
      provider,
      message:
        "OIDC flow is reserved for the BFF/auth iteration. Tokens must stay server-side.",
    })
  })

  app.get("/auth/oidc/:provider/callback", async (request, reply) => {
    const { provider } = request.params as { provider: string }

    return reply.code(501).send({
      error: "oidc_callback_not_configured",
      provider,
    })
  })

  app.get("/auth/saml/:provider/metadata", async (request, reply) => {
    const { provider } = request.params as { provider: string }
    const entityId =
      process.env.SAML_ENTITY_ID ??
      `http://localhost:8089/auth/saml/${provider}/metadata`
    const acsUrl =
      process.env.SAML_ACS_URL ??
      `http://localhost:8089/auth/saml/${provider}/acs`

    return reply
      .type("application/xml")
      .send(
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          `<EntityDescriptor entityID="${entityId}" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">`,
          '  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
          `    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" />`,
          "  </SPSSODescriptor>",
          "</EntityDescriptor>",
        ].join("\n")
      )
  })

  app.post("/auth/saml/:provider/acs", async (request, reply) => {
    const { provider } = request.params as { provider: string }

    return reply.code(501).send({
      error: "saml_acs_not_configured",
      provider,
      message: "SAML assertion validation and certificate checks are not enabled yet.",
    })
  })
}
