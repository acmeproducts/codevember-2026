// Stand-in for next/link in the standalone pages: a plain anchor to the sibling .html file.
import type { AnchorHTMLAttributes } from "react";
import { toFile } from "./next-navigation";

export default function Link({ href, prefetch, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  void prefetch;
  return <a href={toFile(href)} {...rest} />;
}
