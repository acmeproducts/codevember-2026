// The whole of one day as a page: the stage, its HUD and the loader, with no calendar and no router.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { dayFromSlug } from "@/shared/days";
import Stage from "@/shared/engine/Stage";
import { Loader, type LoadStep } from "@/shared/ui/Loader";
import { CrashScreen } from "@/shared/ui/Shell";
import { toFile } from "./next-navigation";

declare const __SLUG__: string;
const day = dayFromSlug(__SLUG__)!;

function Page() {
  const [step, setStep] = useState<LoadStep>("engine");
  return (
    <CrashScreen>
      <Stage day={day} onStep={setStep} />
      <Loader day={day} step={step} />
    </CrashScreen>
  );
}

// Plain links written for the site ("/", "/NN-word/") go to the sibling files instead.
document.addEventListener(
  "click",
  (event) => {
    const href = (event.target as Element | null)?.closest?.("a")?.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    event.preventDefault();
    window.location.assign(toFile(href));
  },
  true
);

createRoot(document.querySelector(".cv-root")!).render(<Page />);
