import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { ROLES } from "@/lib/roles";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      // The demo is the entry point paid and organic traffic should land
      // on — it shows the product working before asking for an account.
      url: `${SITE_URL}/demo`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    // One page per wedding role. These are the money pages: search
    // demand is by role, not by category (see ART-810).
    ...ROLES.map((r) => ({
      url: `${SITE_URL}/${r.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
