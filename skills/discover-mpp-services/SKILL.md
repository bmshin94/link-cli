---
name: discover-mpp-services
description: Discover machine-payable APIs and providers when a user asks which MPP service can perform a task, wants to browse available services, or needs an endpoint before paying.
---

# Discover MPP services

Use the [MPP services directory](https://mpp.dev/services) to find services,
providers, endpoints, request examples, and advertised pricing.

Discovery is read-only and does not authorize a purchase. Treat catalog details
as advisory: before payment, probe the selected endpoint and use its live HTTP
402 challenge as the authoritative source for payment terms.

When the user chooses a service and asks to pay, use the
`create-payment-credential` skill and complete the request with
`link-cli mpp pay`.
