// Stand-in for next/navigation in the standalone pages. "/" is index.html, "/NN-word/" is NN-word.html, side by side.
export const toFile = (href: string) => {
  if (!href.startsWith("/")) return href;
  const slug = href.replace(/^\//, "").replace(/\/$/, "");
  return slug ? `${slug}.html` : "index.html";
};

const router = {
  push: (href: string) => window.location.assign(toFile(href)),
  replace: (href: string) => window.location.replace(toFile(href)),
  prefetch: () => {},
  back: () => window.history.back()
};
export const useRouter = () => router;
export const usePathname = () => "/";
export const notFound = () => {
  throw new Error("Not found");
};
