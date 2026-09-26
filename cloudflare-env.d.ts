declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    SURVEY_SIGNING_KEY?: string;
    VK_ENCRYPTION_KEY?: string;
    BUCKET?: R2Bucket;
  }
}
