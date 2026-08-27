"use client";

import { Settings } from "lucide-react";
import { motion } from "motion/react";
import { useThreadrift } from "@threadrift/react";

export function EditorToggle() {
  const editorOpen = useThreadrift((s) => s.editorOpen);
  const toggleEditor = useThreadrift((s) => s.toggleEditor);

  return (
    <motion.button
      onClick={toggleEditor}
      className="fixed bottom-6 right-6 z-[200] w-12 h-12 rounded-full 
        bg-zinc-900/80 backdrop-blur-xl border border-white/10 
        flex items-center justify-center 
        hover:bg-zinc-800/90 hover:border-white/20 
        transition-colors duration-200 shadow-2xl shadow-black/50
        cursor-pointer pointer-events-auto"
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      title="Toggle Threadrift Studio"
    >
      <motion.div
        animate={{ rotate: editorOpen ? 180 : 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <Settings className="w-5 h-5 text-zinc-400" />
      </motion.div>
    </motion.button>
  );
}
