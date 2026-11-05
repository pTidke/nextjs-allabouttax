import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/contact", "/library"].map((route) => ({
    url: `https://allabouttax.in${route}`,
    changeFrequency: "weekly",
    priority: route === "" ? 1 : 0.7,
  }));
}
