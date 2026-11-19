// Stand-in for next/dynamic: everything is already in the page, so this is only React.lazy.
import { lazy, Suspense, type ComponentType } from "react";

export default function dynamic<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  const Lazy = lazy(load);
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={null}>
        <Lazy {...(props as never)} />
      </Suspense>
    );
  };
}
