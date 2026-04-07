# API / Interface Contracts

## Overview
<!-- What does the API surface look like? REST, GraphQL, RPC, etc. -->

## Endpoints

### [Resource Name]

#### Create [Resource]
```
POST /resource
Body: {
  name: string (required)
  description: string (optional)
}
Response 201: {
  id: string
  name: string
  created_at: timestamp
}
Errors: 400 (validation), 401 (unauthorized)
```

#### List [Resources]
```
GET /resources?page=1&limit=20&sort=created_at
Response 200: {
  data: [Resource]
  total: number
  page: number
}
```

## Authentication
<!-- How do users authenticate? -->

## Error Format
```
{
  error: {
    code: string
    message: string
    details: object (optional)
  }
}
```

## Rate Limits & Quotas
<!-- Any limits on usage? -->
