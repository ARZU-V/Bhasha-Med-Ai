# Lambda Environment Variables

Set these in AWS Console → Lambda → [function] → Configuration → Environment variables

## All functions need:
| Variable | Value |
|----------|-------|
| `AWS_REGION_NAME` | `ap-south-1` |

## voice-process:
| Variable | Value |
|----------|-------|
| `S3_BUCKET` | `bhasha-ai-audio-YOURNAME` |
| `DYNAMODB_CONVERSATIONS_TABLE` | `BhashaAI_Conversations` |

## medication-crud:
| Variable | Value |
|----------|-------|
| `DYNAMODB_MAIN_TABLE` | `BhashaAI_Main` |

## book-appointment:
| Variable | Value |
|----------|-------|
| `DYNAMODB_CALL_STATUS_TABLE` | `BhashaAI_CallStatus` |
| `EXOTEL_ACCOUNT_SID` | *(Exotel dashboard → Settings)* |
| `EXOTEL_API_KEY` | *(Exotel dashboard → API Keys)* |
| `EXOTEL_API_TOKEN` | *(Exotel dashboard → API Keys)* |
| `EXOTEL_PHONE` | *(your ExoPhone e.g. 08039XXXXXX)* |
| `API_BASE_URL` | `https://4zu47eekcg.execute-api.ap-south-1.amazonaws.com/Prod` |

## call-status:
| Variable | Value |
|----------|-------|
| `DYNAMODB_CALL_STATUS_TABLE` | `BhashaAI_CallStatus` |

## connect-callback:
| Variable | Value |
|----------|-------|
| `DYNAMODB_CALL_STATUS_TABLE` | `BhashaAI_CallStatus` |

## exoml-applet: *(NEW)*
| Variable | Value |
|----------|-------|
| `DYNAMODB_CALL_STATUS_TABLE` | `BhashaAI_CallStatus` |

## emergency-trigger:
| Variable | Value |
|----------|-------|
| `DYNAMODB_MAIN_TABLE` | `BhashaAI_Main` |

## emergency-cancel:
| Variable | Value |
|----------|-------|
| `DYNAMODB_MAIN_TABLE` | `BhashaAI_Main` |

## health-log:
| Variable | Value |
|----------|-------|
| `DYNAMODB_MAIN_TABLE` | `BhashaAI_Main` |

## voice-transcribe: *(NEW)*
| Variable | Value |
|----------|-------|
| `S3_BUCKET` | `bhasha-ai-audio-YOURNAME` |

## medicine-check: *(NEW)*
| Variable | Value |
|----------|-------|
| `DYNAMODB_MAIN_TABLE` | `BhashaAI_Main` |

## medicine-scan: *(NEW — uses Nova Lite for vision)*
| Variable | Value |
|----------|-------|
| *(no extra vars needed)* | Model is hardcoded to `amazon.nova-lite-v1:0` |

## hospital-finder: *(NEW)*
| Variable | Value |
|----------|-------|
| `LOCATION_INDEX_NAME` | `BhashaAI_PlaceIndex` |

## profile-crud: *(NEW)*
| Variable | Value |
|----------|-------|
| `DYNAMODB_MAIN_TABLE` | `BhashaAI_Main` |
