/** Blog posts from src/pages/blog/*.md frontmatter, for /sitemap.xml and /llms.txt. */
export type BlogPost = { path: string; title: string; description: string; lastmod?: string };

const day = (d: unknown) => (d ? new Date(d as string).toISOString().split("T")[0] : undefined);

export const BLOG_POSTS: BlogPost[] = Object.entries(import.meta.glob("../pages/blog/*.md", { eager: true }) as Record<string, any>)
  .map(([file, mod]) => ({
    path: `/blog/${file.split("/").pop()!.replace(/\.md$/, "")}`,
    title: String(mod.frontmatter?.title ?? ""),
    description: String(mod.frontmatter?.description ?? ""),
    // Real change date: updatedDate, else pubDate. Never "today".
    lastmod: day(mod.frontmatter?.updatedDate ?? mod.frontmatter?.pubDate),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));
