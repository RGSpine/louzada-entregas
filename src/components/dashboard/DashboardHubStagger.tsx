"use client";

import { Children, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { menuItemVariants, menuStaggerVariants } from "@/design/motion-presets";

type Props = {
  children: ReactNode;
  className?: string;
};

/** Lista de cards do hub com stagger leve (≤400ms por item). */
export function DashboardHubStagger({ children, className }: Props) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={menuStaggerVariants}
      initial="hidden"
      animate="show"
    >
      {Children.toArray(children).map((child, index) =>
        child ? (
          <motion.div key={index} variants={menuItemVariants}>
            {child}
          </motion.div>
        ) : null,
      )}
    </motion.div>
  );
}
