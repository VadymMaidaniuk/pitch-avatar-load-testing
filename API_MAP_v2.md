# Avatar Creation — API Endpoints Map (for AQA)

> **Page:** `packages/web-app/src/pages/avatarCreation/`
> **Base URL:** `VITE_APP_API_URL` (env variable)
> **Default Headers:**
>
> | Header | Value |
> |--------|-------|
> | `Content-Type` | `application/vnd.api+json` |
> | `Authorization` | `Bearer {accessToken}` |
> | `Accept-Language` | `{i18nextLng \|\| navigator.language}` |
> | `Device-Id` | `{deviceUuid}` (optional) |
> | `x-amzn-trace-id` | `{traceId}` |
>
> File uploads override `Content-Type` to `multipart/form-data`.

---

## Table of Contents

1. [Assistant (Avatar) CRUD](#1-assistant-avatar-crud)
2. [Presentation CRUD](#2-presentation-crud)
3. [Goals Management](#3-goals-management)
4. [Assistant Roles](#4-assistant-roles)
5. [Knowledge Source (External Content)](#5-knowledge-source-external-content)
6. [File Uploads](#6-file-uploads)
7. [Screening (Test Link)](#7-screening-test-link)
8. [Media Generation](#8-media-generation)
9. [Global / Reference Data](#9-global--reference-data)
10. [WebSocket Events](#10-websocket-events)
11. [User Flows (E2E Scenarios)](#11-user-flows-e2e-scenarios)
12. [Validation Constraints](#12-validation-constraints)

---

## 1. Assistant (Avatar) CRUD

### 1.1 GET Assistant by ID

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/assistants/{assistantId}?include=assistant-role,assistant-role.goals,presentation,presentation` |
| Called in | `hooks/useAssistantData.ts:151` |
| When      | Page mount in EDIT mode |

**Response** — JSON:API with included relations:

```jsonc
{
  "data": {
    "id": "string",
    "type": "assistants",
    "attributes": {
      "name": "string",
      "chat_name": "string",
      "language_id": "string",
      "is_active": true,
      "instructions": "string",
      "is_video_avatar_enabled": true,
      "is_voiceover_enabled": true,
      "is_voice_recognition_enabled": false,
      "is_draft": false,
      "pretranslate_enabled": false,
      "has_pretranslate_dialog": false,
      "avatar_settings": {
        "video_type": "talk",                // "talk" | "clip"
        "talk_image_url": "string",          // present when video_type="talk"
        "clip_driver_id": "string|null",     // present when video_type="clip"
        "clip_presenter_id": "string",       // present when video_type="clip"
        "audio": {
          "vendor": "internal",
          "speech_voice_id": "string",
          "voice": "string"
        },
        "lipsync": {
          "avatar_image_id": "string"
        },
        "is_streamable": true
      },
      "pst_content": ["contentId1", "contentId2"],
      "prompt": "string"
    },
    "relationships": {
      "presentation": { "data": { "type": "presentations", "id": "string" } },
      "assistant-role": { "data": { "type": "assistant-roles", "id": "string" } }
    }
  },
  "included": [
    // assistant-role objects with nested goals, presentation data
  ]
}
```

---

### 1.2 CREATE Assistant

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/assistants` |
| Called in | `utils/requestHelpers.ts:387` — `createAssistantRequest()` |
| When      | Final submit — user clicks "Create" |

**Request payload** (built by `getAssistantRequestAttributes`):

```jsonc
{
  "data": {
    "type": "assistants",
    "attributes": {
      "name": "string",                            // required — avatar name
      "chat_name": "string",                       // chat display name
      "language_id": "string|number",              // required — selected language ID
      "is_active": true,                           // always true (hardcoded)
      "instructions": "string",                    // free-text from chat instructions placeholder
      "is_video_avatar_enabled": true,             // = videoEnabled && audioEnabled
      "is_voiceover_enabled": true,                // = videoEnabled || audioEnabled
      "is_voice_recognition_enabled": false,       // = microphoneEnabled
      "avatar_settings": {
        // CONDITIONAL: video_type is "clip" if clip_driver_id OR clip_presenter_id is truthy, else "talk"
        "video_type": "talk",                      // "talk" | "clip"

        // CONDITIONAL: only when video_type="talk" (talk_image_url is truthy)
        "talk_image_url": "https://...",           // avatar photo URL

        // CONDITIONAL: only when video_type="clip" (clip_driver_id or clip_presenter_id is truthy)
        "clip_driver_id": "string",
        "clip_presenter_id": "string",

        "audio": {
          // VARIANT A: when speech_voice_id is set (user selected a voice)
          "vendor": "internal",
          "speech_voice_id": "string"
          // VARIANT B: when no speech_voice_id but oldAudioData exists (edit mode)
          // → spreads oldAudioData object as-is
          // VARIANT C: fallback (no voice selected, no old data)
          // → { "vendor": "internal", "voice": "120" }
        },
        "lipsync": {
          "avatar_image_id": "string|null"         // from selected photo
        },
        "is_streamable": true                      // from selected photo's is_streamable flag
      },
      "pst_content": ["contentId1", "contentId2"], // knowledge source IDs (only items with useForKnowledgeSource=true)
      "prompt": "string",                          // selectedAssistantRole.prompt
      "is_draft": false,                           // isDraftMode flag
      "pretranslate_enabled": false,
      "has_pretranslate_dialog": false
    },
    "relationships": {
      "presentation": {
        "data": { "type": "presentations", "id": "presentationId" }
      },
      "assistant-role": {
        "data": { "type": "assistant-roles", "id": "roleId" }  // CONDITIONAL: only when roleId exists
      }
    }
  }
}
```

**Response:**

```jsonc
{ "data": { "id": "newAssistantId", "type": "assistants", "attributes": { /* ... */ } } }
```

---

### 1.3 UPDATE Assistant

| Field     | Value |
|-----------|-------|
| Method    | `PATCH` |
| URL       | `/assistants/{assistantId}` |
| Called in | `utils/requestHelpers.ts:438` — `updateAssistantRequest()` |
| When      | Final submit in EDIT mode |

**Request payload:** Same as 1.2, with `"id": "assistantId"` added to `data`.

---

## 2. Presentation CRUD

### 2.1 GET Presentations (table list)

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/presentations` |
| Called in | `components/tabs/PitchContent/hooks/useAvatarPresentationsTable.tsx` |
| When      | PitchContent tab mount + pagination/filter/sort changes |

**Fixed query params (always sent):**

| Param | Value |
|-------|-------|
| `include` | `company,available-for-companies,files,assistant,assistant.files` |
| `filter[unhidden]` | `1` |
| `filter[companyHidden]` | `0` |
| `filter[owner]` | `{me.id}` |
| `filter[isParent]` | `1` (appended via filterString) |

**Dynamic query params:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `page[size]` | number | `5` | |
| `page[number]` | number | `1` | 1-based (pageIndex + 1) |
| `filter[search]` | string | — | Only when search text is entered |
| `filter[{columnId}]` | string | — | Per-column filter |
| `sort` | string | — | Prefix `-` for DESC |

**Sort column mapping:**

| UI Column ID | API sort key |
|-------------|-------------|
| `by_title` | `title` |
| `by_date` | `createdAt` |
| `by_language` | `language_id` |

**Response** — `IPresentationsResponse` (JSON:API):

```jsonc
{
  "data": [
    {
      "id": "string",
      "type": "presentations",
      "attributes": {
        "title": "string",
        "createdAt": "string",
        "language_id": "string",
        "status": "string"
        // ...
      },
      "relationships": {
        "company": { /* ... */ },
        "files": { /* ... */ },
        "assistant": { /* ... */ }
      }
    }
  ],
  "included": [ /* company, files, assistant objects */ ],
  "links": { "first": "...", "last": "...", "prev": "...", "next": "..." },
  "meta": {
    "page": {
      "last-page": 10,
      "total": 50
    }
  }
}
```

---

### 2.2 CREATE Presentation (empty, for avatar)

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/presentations` |
| Called in | `hooks/useAvatarCreation.ts:337` — `handleCreateTargetPresentation()` |
| When      | Auto-created when user proceeds past step 1 |

**Request payload:**

```jsonc
{
  "data": {
    "type": "presentations",
    "attributes": {
      "title": "Not finished presentation",       // hardcoded string
      "has_assistant": false,                      // hardcoded false
      "is_widget_data": false                      // = isWidgetChecked from Redux
    }
  }
}
```

**Response:**

```jsonc
{ "data": { "id": "newPresentationId", "type": "presentations", "attributes": { /* ... */ } } }
```

---

### 2.3 Copy Presentation to Target

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/presentations/{selectedPresentationId}/copy-to-assistant/{targetPresentationId}` |
| Called in | `hooks/useAvatarCreation.ts:365` — `handleSendRequestToCopy()` |
| When      | User selects a presentation from the table |

**Request payload:** `{}` (empty body)

**Response:** `IPresentation` — triggers WebSocket `.PresentationCopiedToAssistant`

---

### 2.4 UPDATE Presentation (title)

| Field     | Value |
|-----------|-------|
| Method    | `PATCH` |
| URL       | `/presentations/{presentationId}` |
| Called in | `hooks/useAvatarCreation.ts` — after copy completes and in WebSocket handler |
| When      | After presentation copy — updates title |

**Request payload:**

```jsonc
{
  "data": {
    "id": "presentationId",                        // String(targetPresentationId)
    "type": "presentations",
    "attributes": {
      "title": "string"                            // "Widget_{assistantName}" when isWidgetChecked, or presentationTitle from copy event
    }
  }
}
```

---

### 2.5 DELETE Presentation

| Field     | Value |
|-----------|-------|
| Method    | `DELETE` |
| URL       | `/presentations/{presentationId}` |
| Called in | `hooks/useAvatarCreation.ts:469` — `handleDeleteTargetPresentation()` |
| When      | User cancels avatar creation — cleanup |

---

## 3. Goals Management

### 3.1 GET All Presentation Goals

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/goals/presentation-and-system-goals/{presentationId}` |
| Called in | `utils/requestHelpers.ts:176` and `hooks/useAssistantData.ts` |
| When      | After attaching goals to presentation; on edit page load |

**Response:**

```jsonc
[
  {
    "id": "string",
    "name": "string",
    "goal_type": "avatar_behaviour | avatar_instruction | answer_control | presentation_instruction",
    "triggers": [
      {
        "id": "string",
        "base_rule": "string",
        "trigger_parameters": {
          "paramKey": { "rule": "string", "data": "any" }
        },
        "actions": [
          {
            "id": "string",
            "action_parameters": {
              "key": "value"
            }
          }
        ]
      }
    ],
    "global_parameters": { "key": "value" }
  }
]
```

---

### 3.2 GET Available Role Goals

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/assistant-and-system-goals` or `/assistant-and-system-goals?assistantRole={roleId}` |
| Called in | `useCustomizeAvatar.ts:109` (direct Axios), RTK Query `getAvailableRoleGoals` |
| When      | User selects a role in CustomizeAvatar tab |

**Query params:**

| Param | Value | Notes |
|-------|-------|-------|
| `assistantRole` | `{roleId}` | Optional — omitted when fetching all system goals |

**Response:** Same goal structure as 3.1, categorized by `goal_type`.

---

### 3.3 Attach Goals to Presentation (two-phase)

| Field     | Value |
|-----------|-------|
| Method    | `PATCH` |
| URL       | `/presentations/{presentationId}` |
| Called in | `utils/requestHelpers.ts:171` — `handleAttachRoleGoalsIntoAssistantPresentation()` |
| When      | Before creating/updating assistant — binds selected goals |

> **Important:** This is called **twice** per goal set — first with empty `substitution_data`, then per-goal with full trigger/action data.

**Phase 1 — Initial attach (empty substitution):**

```jsonc
{
  "data": {
    "type": "presentations",
    "id": "presentationId",
    "relationships": {
      "goals": {
        "data": [
          { "type": "goals", "id": "goalId1" },
          { "type": "goals", "id": "goalId2" }
        ]
      }
    }
  },
  "substitution_data": []
}
```

**Phase 2 — Per goal with substitution data:**

```jsonc
{
  "data": {
    "type": "presentations",
    "id": "presentationId",
    "relationships": {
      "goals": {
        "data": [
          { "type": "goals", "id": "goalId1" },
          { "type": "goals", "id": "goalId2" }
        ]
      }
    }
  },
  "substitution_data": [
    {
      "trigger_id": "string",                      // String(trigger.id)
      "base_rule": "string",                       // trigger.baseRule
      "trigger_parameters": {
        // One key per setting; key = setting.parameter || setting.original?.parameter
        "paramKey": {
          "rule": "string",                        // setting.rule
          "data": "any"                            // setting.data
        }
      },
      "actions": [                                 // CONDITIONAL — only when filteredActions.length > 0
        {
          "action_id": "string",                   // String(action.id)
          "action_parameters": {
            // All keys from action.data EXCEPT "substitutions" and "tooltip"
            // SPECIAL: if key === "leadForm" → mapped array of field objects (field.name ? field : null)
            "key": "value"
          }
        }
      ]
    }
  ]
}
```

---

## 4. Assistant Roles

### 4.1 GET Roles List (RTK Query)

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/assistant-roles?include=goals` |
| Called in | `useGetAssistantRolesQuery()` via `useCustomizeAvatar.ts:69` |
| When      | CustomizeAvatar tab mount |

**Response** — JSON:API collection:

```jsonc
{
  "data": [
    {
      "id": "string",
      "type": "assistant-roles",
      "attributes": {
        "name": "string",
        "description": "string",
        "prompt": "string",
        "position": 0
      },
      "relationships": {
        "goals": {
          "data": [
            { "type": "goals", "id": "string" }
          ]
        }
      }
    }
  ],
  "included": [
    // goal objects
  ]
}
```

---

### 4.2 DELETE Role (RTK Query Mutation)

| Field     | Value |
|-----------|-------|
| Method    | `DELETE` |
| URL       | `/assistant-roles/{roleId}` |
| Called in | `useDeleteAssistantRoleMutation()` via `useCustomRoleSelect.ts` |
| When      | User deletes a role from dropdown |

---

### 4.3 CREATE Role (RTK Query Mutation)

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/assistant-roles` |
| Called in | `RoleCreationModal` (via `useCreateAssistantRoleMutation`) |

**Request payload:**

```jsonc
{
  "data": {
    "type": "assistant-roles",
    "attributes": {
      "name": "string",
      "description": "string"
    },
    "relationships": {
      "goals": {
        "data": [
          { "type": "goals", "id": "goalId" }
        ]
      }
    }
  },
  "override_data": {
    // overridden goal trigger/action parameters (same structure as substitution_data items)
  }
}
```

---

### 4.4 UPDATE Role (RTK Query Mutation)

| Field     | Value |
|-----------|-------|
| Method    | `PATCH` |
| URL       | `/assistant-roles/{roleId}` |
| Called in | `RoleCreationModal` (via `useUpdateAssistantRoleMutation`) |

**Request payload:** Same as 4.3 with `"id": "roleId"` in `data`.

---

### 4.5 Copy Role (RTK Query Mutation)

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/assistant-roles/{roleId}/copy` |
| Body      | `{}` |

---

## 5. Knowledge Source (External Content)

### 5.1 GET User External Content

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/pst-content/?filter[userId]={userId}&include=pstContentImages,pstContentUrls,pstContentWebUrls` |
| Called in | `hooks/useAssistantData.ts:92` |
| When      | Page mount in EDIT mode |

---

### 5.2 CREATE External Content

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/pst-content` |
| Called in | `components/tabs/KnowledgeSource/hooks/useKnowledgeSourceForm.ts` |
| When      | User submits knowledge source form |

Payload varies by active tab. All payloads are wrapped as `{ data: { type: "pst-content", attributes: { ... } } }`.

**TEXT tab:**

```jsonc
{
  "data": {
    "type": "pst-content",
    "attributes": {
      "text": "string",                            // user entered text (max 50,000 chars)
      "name": "string",                            // text.slice(0, 255)
      "resource_type": "text",
      "scope": "presentation",                     // hardcoded
      "presentation_id": "string"                  // target_presentation_id
    }
  }
}
```

**LINK tab — with CSV file uploaded:**

```jsonc
{
  "data": {
    "type": "pst-content",
    "attributes": {
      "name": "string",                            // fileValue.name.slice(0, 255)
      "url": "string",                             // tmp file URL from /d-id/upload-tmp-file
      "resource_type": "url",
      "parse_images": true,                        // checkbox value
      "scope": "presentation",
      "presentation_id": "string"
    }
  }
}
```

**LINK tab — raw URL/text (no file):**

```jsonc
{
  "data": {
    "type": "pst-content",
    "attributes": {
      "name": "string",                            // data.link.slice(0, 255)
      "text": "string",                            // data.link (the URL string)
      "resource_type": "url",
      "parse_images": true,                        // checkbox value
      "scope": "presentation",
      "presentation_id": "string"
    }
  }
}
```

**FILE tab — non-image file:**

```jsonc
{
  "data": {
    "type": "pst-content",
    "attributes": {
      "url": "string",                             // tmp file URL from /d-id/upload-tmp-file
      "name": "string",                            // fileValue.name
      "resource_type": "file",
      "parse_images": true,                        // checkbox value
      "scope": "presentation",
      "presentation_id": "string"
    }
  }
}
```

**FILE tab — image upload:**

```jsonc
{
  "data": {
    "type": "pst-content",
    "attributes": {
      "name": "string",                            // data.imageName
      "url": "string",                             // saved image URL
      "text": "string",                            // data.imageDescription
      "resource_type": "image",                    // NOT "file" — different resource_type for images
      "scope": "presentation",
      "presentation_id": "string"
    }
  }
}
```

**WEBLINK tab:**

```jsonc
{
  "data": {
    "type": "pst-content",
    "attributes": {
      "name": "string",                            // data.title
      "description": "string",                     // data.description
      "resourceType": "weblink",                   // NOTE: camelCase key (not resource_type)
      "contentName": "string",                     // data.title (duplicate)
      "url": "string",                             // data.url
      "contentType": "webpage",                    // hardcoded
      "pageContent": "string",                     // data.title (same as name)
      "scope": "presentation",
      "presentation_id": "string"
    }
  }
}
```

**Response (all types):**

```jsonc
{ "data": { "data": { "id": "newContentId", "type": "pst-content", "attributes": { /* ... */ } } } }
```

---

### 5.3 UPDATE External Content

| Field     | Value |
|-----------|-------|
| Method    | `PATCH` |
| URL       | `/pst-content/{contentId}?include=pstContentImages,pstContentUrls,pstContentWebUrls` |
| Called in | `useKnowledgeSourceForm.ts` |
| When      | User edits existing item |

**Request payload:** Same attribute shapes as 5.2 per tab type, with `"id": "contentId"` in `data`.

---

### 5.4 DELETE External Content

| Field     | Value |
|-----------|-------|
| Method    | `DELETE` |
| URL       | `/pst-content/{contentId}` |
| Called in | `KnowledgeContentItems.tsx` |

**Response:** HTTP 204

---

### 5.5 CREATE Image Group

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/pst-content-images` |
| Called in | `useKnowledgeSourceForm.ts` |
| When      | FILE tab — after creating pst-content, if image is attached |

**Request payload** (attributes = same IMAGE fieldData from 5.2):

```jsonc
{
  "data": {
    "type": "pst-content-images",
    "attributes": {
      "name": "string",                            // image name
      "url": "string",                             // image URL
      "text": "string",                            // image description
      "resource_type": "image"
    },
    "relationships": {
      "pst-content": {
        "data": { "type": "pst-content", "id": "parentContentId" }
      }
    }
  }
}
```

---

### 5.6 UPDATE Image Group

| Field     | Value |
|-----------|-------|
| Method    | `PATCH` |
| URL       | `/pst-content-images/{imageGroupId}` |
| Called in | `useKnowledgeSourceForm.ts` |

**Request payload:** Same attributes as 5.5, with `"id": "imageGroupId"` in `data`. No `relationships`.

---

### 5.7 CREATE Weblink Group

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/pst-content-web-urls` |
| Called in | `useKnowledgeSourceForm.ts` |
| When      | WEBLINK tab — after creating pst-content |

**Request payload** (attributes = same WEBLINK fieldData from 5.2):

```jsonc
{
  "data": {
    "type": "pst-content-web-urls",
    "attributes": {
      "name": "string",
      "description": "string",
      "resourceType": "weblink",                   // camelCase
      "contentName": "string",
      "url": "string",
      "contentType": "webpage",
      "pageContent": "string"
    },
    "relationships": {
      "pst-content": {
        "data": { "type": "pst-content", "id": "parentContentId" }
      }
    }
  }
}
```

---

### 5.8 UPDATE Weblink Group

| Field     | Value |
|-----------|-------|
| Method    | `PATCH` |
| URL       | `/pst-content-web-urls/{weblinkGroupId}` |
| Called in | `useKnowledgeSourceForm.ts` |

**Request payload:** Same attributes as 5.7, with `"id": "weblinkGroupId"` in `data`. No `relationships`.

---

### 5.9 Generate Image Description (AI)

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/pst-content/describe-image` |
| Called in | `useKnowledgeSourceForm.ts` |
| When      | User uploads image and clicks "Generate description" |

**Request payload** (NOTE: no `type` field — unlike all other mutations):

```jsonc
{
  "data": {
    "attributes": {
      "url": "string"                              // uploaded image URL
    }
  }
}
```

**Response:**

```jsonc
{ "data": { "data": { "attributes": { "description": "AI-generated text" } } } }
```

---

## 6. File Uploads

### 6.1 Upload Temporary File

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/d-id/upload-tmp-file` |
| Headers   | `Content-Type: multipart/form-data` |
| Called in | `useKnowledgeSourceForm.ts` — `saveFile()` |
| When      | FILE/LINK tab — user attaches a file |

**Request:** `FormData`:

| Field | Value |
|-------|-------|
| `file` | `File` object |

**Response:**

```jsonc
{ "data": { "data": { "attributes": { "url": "https://tmp-file-url" } } } }
```

---

### 6.2 Upload File — Knowledge Source Image

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/files` |
| Headers   | `Content-Type: multipart/form-data` |
| Called in | `useKnowledgeSourceForm.ts` — `saveImageFileForKnowledgeSource()` |
| When      | FILE tab — after creating image group |

**Request:** `FormData`:

| Field | Value |
|-------|-------|
| `fileable_type` | `"pst-content-images"` (hardcoded) |
| `fileable_id` | `{imageGroupId}` |
| `fileable_attribute` | `"image"` (hardcoded) |
| `file` | `Blob` (currentImageBlob) |

**Response:** `IFileUploadResponse`

---

### 6.3 Upload File — Avatar Image (custom photo)

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/files` |
| Headers   | `Content-Type: multipart/form-data` |
| Called in | `features/avatar/avatarsLibrary/api/avatarsLibrary.api.ts` — `useUploadAvatarImageFileMutation` |
| When      | CreateAvatar tab — user uploads a custom avatar photo |

**Request:** `FormData`:

| Field | Value |
|-------|-------|
| `fileable_type` | `"avatar-images"` (hardcoded) |
| `fileable_id` | `{avatarImageId}` |
| `fileable_attribute` | `"image"` (hardcoded) |
| `file` | `Blob` (renamed to `avatar.png`) |

---

## 7. Screening (Test Link)

### 7.1 CREATE Screening

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/screenings?include=setting` |
| Called in | `utils/requestHelpers.ts:458` — `createAndOpenTestScreeningLink()` |
| When      | After assistant created — auto-generates test screening link |

**Request payload (all values hardcoded):**

```jsonc
{
  "data": {
    "type": "screenings",
    "attributes": {
      "title": "Assistant test",                   // hardcoded
      "mode": "offline",                           // hardcoded
      "available": true,                           // hardcoded
      "admins": ["userId"],                        // array with single current user ID
      "start_slide_position": 1,                   // hardcoded
      "generate_short_link": true,                 // hardcoded
      "is_attach_pdf": true,                       // hardcoded
      "is_test": true                              // hardcoded
    },
    "relationships": {
      "presentation": {
        "data": { "type": "presentations", "id": "presentationId" }
      }
    }
  }
}
```

**Response:**

```jsonc
{
  "data": {
    "id": "string",
    "attributes": { "url": "https://screening-link" }
  },
  "included": [
    {
      "id": "screeningSettingsId",
      "type": "screening-settings",
      "attributes": { /* ... */ }
    }
  ]
}
```

---

### 7.2 UPDATE Screening Settings

| Field     | Value |
|-----------|-------|
| Method    | `PATCH` |
| URL       | `/screening-settings/{screeningSettingsId}` |
| Called in | `utils/requestHelpers.ts:510` |
| When      | Right after creating screening |

**Request payload (all values hardcoded defaults):**

```jsonc
{
  "data": {
    "type": "screening-settings",
    "id": "screeningSettingsId",
    "attributes": {
      "ask_password": false,
      "screening_user_attributes": [],
      "screening_user_attributes_required": [],
      "screening_user_data": {
        "company_name": "",
        "country": "",
        "industry": "",
        "last_name": "",
        "name": "",
        "photo_weblink": "",
        "summary": ""
      },
      "screening_user_photo_data": { "id": "", "url": "" },
      "allow_slide_share": false,
      "allow_ask_questions": false,
      "allow_comments": false,
      "speed": "fast",                             // NOTE: "fast" not "normal"
      "allow_change_speed": false,
      "use_default_audio": false,                  // NOTE: false not true
      "ask_form_after_slide": 1,                   // NOTE: 1 not 0
      "ask_form_text": "",
      "individual": false,
      "allow_call_presenter": false,
      "allow_schedule_meeting": false,
      "is_voice_recognition": true,                // NOTE: true
      "disable_push": false,
      "calendly_link_url": "",
      "is_slide_feed_visible": false,
      "start_slide_position": 1,                   // NOTE: 1 not 0
      "is_attach_pdf": false,
      "is_send_report": false,
      "is_generate_welcome_slide": false
    }
  }
}
```

---

## 8. Media Generation

### 8.1 Generate Assistant Media

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/presentations/{presentationId}/generate-assistant-media` |
| Called in | `utils/requestHelpers.ts:527` — `generateAssistantMedia()` |
| When      | Final step — triggers avatar video/audio generation |

**Request payload:**

```jsonc
{
  "data": {
    "attributes": {
      "assistant_id": "string",
      "is_test": false                             // false when !isDraft && videoEnabled; true when videoEnabled || audioEnabled
    }
  }
}
```

---

## 9. Global / Reference Data

These endpoints are NOT called directly by avatarCreation components, but their data is consumed on the page. They are fetched by app-level mechanisms and must be available for the page to function.

---

### 9.1 GET Languages

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/languages` |
| Mechanism | Redux Saga — dispatched at app boot (`getLanguagesRequest()`) |
| Consumed in | `useCreateAvatar.tsx:36` via `useSelector(selectLanguages)` |
| When      | App startup (loaded once, cached in Redux) |

**Response:**

```jsonc
{
  "data": [
    {
      "type": "languages",
      "id": "en",                                  // language code
      "attributes": {
        "title": "English",                        // human-readable name
        "flag": "🇬🇧"                              // flag emoji or code
      }
    }
  ]
}
```

**Used in CreateAvatar tab:** Language dropdown (`Autocomplete` component). Selected `language.id` is stored as `language_id` in assistant attributes.

---

### 9.2 GET Speech Voices (paginated)

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/speech-voices?page[number]={pageNumber}&page[size]=999&include=files` |
| Mechanism | Direct Axios + Zustand store (`features/voicesLibrary/hooks/useVoicesData.ts`) |
| Consumed in | `VoicesLibrarySelect` component inside `CreateAvatarTab` |
| When      | VoicesLibrary modal opens |

**Query params:**

| Param | Value | Notes |
|-------|-------|-------|
| `page[number]` | `1, 2, 3...` | Auto-paginated until `current-page === last-page` |
| `page[size]` | `999` | Loads all per page |
| `include` | `files` | Includes audio sample files |

**Response:**

```jsonc
{
  "data": [
    {
      "id": "string",
      "type": "speech-voices",
      "attributes": {
        "name": "string",
        "accent": "string",
        "gender": "string",
        "languages": ["en", "de"],                 // nullable
        "mood": ["string"],                        // nullable
        "is_cloned": false
      },
      "relationships": {
        "files": {
          "data": [{ "id": "string" }]
        }
      }
    }
  ],
  "included": [
    {
      "id": "string",
      "attributes": {
        "url": "string"                            // audio sample URL → mapped to voice.src
      }
    }
  ],
  "meta": {
    "page": {
      "current-page": 1,
      "last-page": 3
    }
  }
}
```

**Used in CreateAvatar tab:** Voice selection modal. Selected `voice.id` becomes `speech_voice_id` in assistant `avatar_settings.audio`.

---

### 9.3 GET Speech Voices Filters

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/speech-voices/filters` |
| Mechanism | Direct Axios + Zustand |
| Consumed in | `VoicesLibrary` filter panel |
| When      | VoicesLibrary modal opens |

**Response:**

```jsonc
{
  "data": {
    "attributes": {
      "accent": ["American", "British"],
      "age": ["Young", "Middle-aged"],
      "mood": ["Friendly", "Professional"],
      "gender": ["Male", "Female"],
      "language": ["en", "de", "fr"]
    }
  }
}
```

---

### 9.4 GET Avatar Images (RTK Query, paginated)

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/avatar-images` |
| Mechanism | RTK Query — `useGetAvatarImagesListQuery()` |
| Consumed in | `AvatarsLibrary` component inside `CreateAvatarTab` |
| When      | CreateAvatar tab mount |

**Query params:**

| Param | Value | Notes |
|-------|-------|-------|
| `page[number]` | `1` | Always 1 (grows page[size] instead) |
| `page[size]` | `{rows * cols * pageNum}` | Grows as user scrolls for infinite scroll |
| `show_first_id` | `{firstPhotoId}` | Optional — pins currently selected avatar first |
| `filter[isAvatarable]` | `1` | Conditional — when filter includes "isAvatarable" |
| `filter[isStreamable]` | `1` | Conditional — when LIPSYNC_V2 feature flag is enabled |

**Response:**

```jsonc
{
  "data": [
    {
      "id": "string",
      "type": "avatar-images",
      "attributes": {
        "available_shapes": ["circle", "square"],
        "extra_data": {
          "generation_type": "string",
          "driver_id": "string|null",              // → clip_driver_id in assistant
          "presenter_id": "string|null",           // → clip_presenter_id in assistant
          "is_streamable": true
        },
        "plane_image_url": "string|null",          // → talk_image_url (preferred)
        "image_url": "string",                     // → talk_image_url (fallback if plane_image_url is null)
        "is_chromakey": false,
        "thumbnail_url": "string",
        "vendor": "string",
        "is_streamable": true
      }
    }
  ],
  "meta": {
    "page": {
      "total": 42
    }
  }
}
```

**Mapping to assistant attributes:**

| Avatar Image field | Assistant attribute |
|-------------------|-------------------|
| `id` | `avatar_settings.lipsync.avatar_image_id` |
| `plane_image_url \|\| image_url` | `avatar_settings.talk_image_url` |
| `extra_data.driver_id` | `avatar_settings.clip_driver_id` |
| `extra_data.presenter_id` | `avatar_settings.clip_presenter_id` |
| `extra_data.is_streamable` | `avatar_settings.is_streamable` |

---

### 9.5 CREATE Avatar Image (empty record)

| Field     | Value |
|-----------|-------|
| Method    | `POST` |
| URL       | `/avatar-images` |
| Mechanism | RTK Query — `useCreateAvatarImageMutation` |
| When      | User uploads a custom photo — creates empty record first, then uploads file via 6.3 |

**Request payload:**

```jsonc
{
  "data": {
    "type": "avatar-images",
    "attributes": {}
  }
}
```

---

### 9.6 DELETE Avatar Image

| Field     | Value |
|-----------|-------|
| Method    | `DELETE` |
| URL       | `/avatar-images/{id}` |
| Mechanism | RTK Query — `useDeleteAvatarImageMutation` |
| When      | User removes a custom-uploaded avatar photo |

---

### 9.7 GET System Media Data (RTK Query)

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/standard-steps?filter[global]` |
| Mechanism | RTK Query — `useGetSystemMediaDataQuery()` |
| Consumed in | `useMediadataSlides.ts`, `ChipsDisplay.tsx`, prefetched in `useAvatarCreation.ts` |
| When      | CustomizeAvatar tab — provides media triggers for goal actions |

> `filter[global]` is a bare flag (no value).

**Response:**

```jsonc
{
  "data": [
    {
      "id": "string",
      "type": "mediadata",
      "attributes": {
        "id": "string",
        "name": "string",                          // display name → used as menu item value
        "image": "string",                         // thumbnail URL
        "scope": "string",
        "type": "string",
        "enabled": true,                           // false items are filtered out
        "language": "string",
        "createdAt": "string",
        "updatedAt": "string"
      }
    }
  ]
}
```

**Used in CustomizeAvatar tab:** `useMediadataSlides` transforms to `{ id, value: name, image }[]` (only `enabled === true`), shown as trigger options in goal chip actions.

---

### 9.8 GET Slides / Slide Types

| Field     | Value |
|-----------|-------|
| Method    | `GET` |
| URL       | `/pst/targets/{presentationId}` |
| Called in | `components/tabs/CustomizeAvatar/hooks/usePresentationSlides.ts:21` |
| When      | CustomizeAvatar tab mount |

**Used in CustomizeAvatar tab:** Provides slide-based trigger options for goal actions alongside media data from 9.7.

---

## 10. WebSocket Events

| Event | Channel | Triggered by | Payload |
|-------|---------|-------------|---------|
| `.PstContentUpdated` | Echo private channel | Backend — after parsing knowledge source item | Updated content item attributes |
| `.PresentationCopiedToAssistant` | Echo private channel | Backend — after presentation copy completes | Copied presentation data with title |

**Listener location:** `hooks/useAvatarCreation.ts`

---

## 11. User Flows (E2E Scenarios)

### Flow 1: Create New Avatar (Happy Path)

```
Prerequisites (loaded at app level):
  ├─ GET /languages                                       (9.1 — at app boot)

Step 1 — CreateAvatar Tab:
  ├─ GET /avatar-images?page[number]=1&page[size]=N&...   (9.4 — load photo grid)
  ├─ GET /speech-voices?page[number]=1&page[size]=999&... (9.2 — when voice modal opens)
  ├─ GET /speech-voices/filters                           (9.3 — voice filter options)
  └─ User fills: name, chatName, language, voice, photo

Step 2 — PitchContent Tab:
  ├─ POST /presentations                                   (2.2 — create empty target)
  ├─ GET  /presentations?filter[isParent]=1&...            (2.1 — load table)
  ├─ User selects presentation from table
  ├─ POST /presentations/{selected}/copy-to-assistant/{target}  (2.3 — copy)
  ├─ ⚡ WebSocket: .PresentationCopiedToAssistant          (confirmation)
  └─ PATCH /presentations/{id}                             (2.4 — update title)

Step 3 — CustomizeAvatar Tab:
  ├─ GET  /assistant-roles?include=goals                   (4.1 — load roles)
  ├─ GET  /standard-steps?filter[global]                   (9.7 — load media data)
  ├─ User selects role
  ├─ GET  /assistant-and-system-goals?assistantRole={id}   (3.2 — load goals)
  ├─ GET  /pst/targets/{presentationId}                    (9.8 — load slides)
  └─ User selects/configures goals and instructions

Step 4 — KnowledgeSource Tab:
  ├─ User adds TEXT item:
  │   └─ POST /pst-content                                (5.2)
  ├─ User adds FILE + image:
  │   ├─ POST /d-id/upload-tmp-file                       (6.1)
  │   ├─ POST /pst-content                                (5.2)
  │   ├─ POST /pst-content-images                         (5.5)
  │   └─ POST /files                                      (6.2)
  ├─ User adds LINK:
  │   ├─ POST /d-id/upload-tmp-file                       (6.1 — if CSV file)
  │   └─ POST /pst-content                                (5.2)
  └─ User adds WEBLINK:
      ├─ POST /pst-content                                (5.2)
      └─ POST /pst-content-web-urls                       (5.7)

Final Submit:
  ├─ PATCH /presentations/{id}                             (3.3 — phase 1: attach goals, empty substitution)
  ├─ PATCH /presentations/{id}                             (3.3 — phase 2: per-goal substitution data)
  ├─ GET   /goals/presentation-and-system-goals/{id}       (3.1 — verify)
  ├─ POST  /assistants                                     (1.2 — create assistant)
  ├─ POST  /screenings?include=setting                     (7.1 — create test link)
  ├─ PATCH /screening-settings/{id}                        (7.2 — configure)
  └─ POST  /presentations/{id}/generate-assistant-media    (8.1 — generate media)
```

### Flow 2: Edit Existing Avatar

```
Page Mount:
  ├─ GET /assistants/{id}?include=...                      (1.1 — load assistant)
  ├─ GET /pst-content/?filter[userId]={id}&include=...     (5.1 — load knowledge)
  ├─ GET /goals/presentation-and-system-goals/{presId}     (3.1 — load current goals)
  ├─ GET /avatar-images?...&show_first_id={photoId}        (9.4 — load photos with current pinned)
  └─ Populate all tabs with existing data

User Modifies & Saves:
  ├─ PATCH /presentations/{id}                             (3.3 — re-attach goals, phase 1 + 2)
  ├─ GET   /goals/presentation-and-system-goals/{id}       (3.1 — verify)
  ├─ PATCH /assistants/{id}                                (1.3 — update assistant)
  └─ POST  /presentations/{id}/generate-assistant-media    (8.1 — re-generate)
```

### Flow 3: Knowledge Source CRUD

```
Create TEXT:    POST /pst-content { resource_type: "text" }
Create LINK:    POST /d-id/upload-tmp-file (if CSV) → POST /pst-content { resource_type: "url" }
Create FILE:    POST /d-id/upload-tmp-file → POST /pst-content { resource_type: "file" }
Create IMAGE:   POST /d-id/upload-tmp-file → POST /pst-content { resource_type: "image" } → POST /pst-content-images → POST /files
Create WEBLINK: POST /pst-content { resourceType: "weblink" } → POST /pst-content-web-urls

Update:   PATCH /pst-content/{id} + optionally PATCH /pst-content-images/{id} or /pst-content-web-urls/{id}
Delete:   DELETE /pst-content/{id}

AI image description: POST /pst-content/describe-image
```

### Flow 4: Cancel Avatar Creation

```
  └─ DELETE /presentations/{targetPresentationId}          (2.5 — cleanup)
```

### Flow 5: Custom Avatar Photo Upload

```
  ├─ POST   /avatar-images                                (9.5 — create empty record)
  ├─ POST   /files { fileable_type: "avatar-images" }     (6.3 — upload file)
  └─ DELETE /avatar-images/{id}                            (9.6 — if user removes photo)
```

### Flow 6: Role Management (inline)

```
  ├─ POST   /assistant-roles                               (4.3 — create role)
  ├─ PATCH  /assistant-roles/{id}                          (4.4 — update role)
  ├─ POST   /assistant-roles/{id}/copy                     (4.5 — copy role)
  └─ DELETE /assistant-roles/{id}                          (4.2 — delete role)
```

---

## 12. Validation Constraints

### Knowledge Source Form

| Constraint | Value |
|-----------|-------|
| Text max length | 50,000 chars |
| Text name max length | 255 chars |
| Image description max length | 300 chars |
| Allowed image extensions | `.jpg`, `.jpeg`, `.bmp`, `.png`, `.gif` |
| Allowed image MIME | `image/jpeg`, `image/bmp`, `image/png`, `image/gif` |
| Image max size | 20 MB |
| CSV file extensions | `.csv` |
| CSV MIME | `text/csv` |
| CSV max size | 20 MB |
| Other file max size | 100 MB |

### Assistant Fields

| Field | Constraint |
|-------|-----------|
| `name` | Required, non-empty |
| `chat_name` | Optional |
| `language_id` | Required |
| `speech_voice_id` | Required when `is_voiceover_enabled=true` and voice was selected |
| `talk_image_url` | Required when `video_type === "talk"` |
| `clip_driver_id` + `clip_presenter_id` | Required when `video_type === "clip"` |
| `avatar_image_id` | Required (from selected photo) |
| `pst_content` | Array of IDs — only items with `useForKnowledgeSource=true` |

### Presentation Table

| Param | Default |
|-------|---------|
| Page size | `5` |
| Page number | `1` (1-based) |
| Sort default | none (server default) |
| `filter[isParent]` | `1` (always) |
| `filter[unhidden]` | `1` (always) |
| `filter[companyHidden]` | `0` (always) |
| `filter[owner]` | current user ID (always) |

### Avatar Images

| Param | Notes |
|-------|-------|
| `filter[isAvatarable]` | `1` — always applied |
| `filter[isStreamable]` | `1` — only when `LIPSYNC_V2` feature flag is enabled |
| Custom photo upload | File renamed to `avatar.png`, type `"avatar-images"` |
