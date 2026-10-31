"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function ScrollRevealProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const revealedSet = new WeakSet<Element>();

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            revealedSet.add(entry.target);
            entry.target.classList.add("is-visible");
          }
        }
      },
      {
        root: null,
        rootMargin: "0px 0px -10px 0px",
        threshold: 0.02,
      }
    );

    const registerElements = () => {
      const targets = document.querySelectorAll(".scroll-reveal");
      targets.forEach((el) => {
        if (revealedSet.has(el)) {
          if (!el.classList.contains("is-visible")) {
            el.classList.add("is-visible");
          }
          return;
        }
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight * 1.05) {
          revealedSet.add(el);
          el.classList.add("is-visible");
        } else {
          io.observe(el);
        }
      });
    };

    registerElements();

    const mo = new MutationObserver(() => {
      registerElements();
    });

    const mainEl = document.querySelector("main") || document.body;
    mo.observe(mainEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [pathname]);

  return <>{children}</>;
}
