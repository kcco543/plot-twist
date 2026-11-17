import { passFrom } from "@/lib/ai/server/beta";
import { aiStatus } from "@/lib/ai/server/config";
import { describeAllowances, imagesAllowed, quotasActive } from "@/lib/ai/server/quota";
import { getMode } from "@/lib/ai/server/usage";
import { betaRequired } from "@/lib/beta/token";

export const dynamic = "force-dynamic";

/**
 * Which AI features this visitor can use right now, and the AI usage mode.
 * Says nothing about the keys themselves. Without a beta pass (when one is
 * required) every AI feature reports as off, so the game uses its built-in
 * lines and never calls the AI routes.
 */
export async function GET(req: Request) {
  const s = aiStatus(getMode());
  const required = betaRequired();
  const unlocked = !required || Boolean(await passFrom(req));
  const images = imagesAllowed();
  const body = {
    ...s,
    text: s.text && unlocked,
    image: s.image && unlocked && images,
    textModel: s.text && unlocked ? s.textModel : null,
    imageModel: s.image && unlocked && images ? s.imageModel : null,
    talk: unlocked ? s.talk : null,
    beta: {
      required,
      unlocked,
      /** What the server could offer once unlocked (so the access panel can say what a code turns on). */
      textAvailable: s.text,
      imageAvailable: s.image && images,
      ...(quotasActive() ? { allowance: describeAllowances() } : {}),
    },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
