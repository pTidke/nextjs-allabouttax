import { type MetadataRoute } from "next";
import { client } from "@/sanity/client";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const query = `*[_type == "post" && defined(slug.current)] {
    "slug": slug.current,
    publishedAt
  }`;

  const posts = await client.fetch(query);

  const blogs = posts.map((post: { slug: string; publishedAt: string }) => ({
    url: `https://allabouttax.in/blog/${post.slug}`,
    lastModified: post.publishedAt || new Date().toISOString(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const routes = [
    "",
    "/blog",
    "/chat",
    "/contact",
  ].map((route) => ({
    url: `https://allabouttax.in${route}`,
    lastModified: new Date().toISOString(),
    changeFrequency: "daily" as const,
    priority: route === "" ? 1 : 0.8,
  }));

  return [...routes, ...blogs];
}
