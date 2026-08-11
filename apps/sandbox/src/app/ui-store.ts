import { create } from "zustand";

type Category = "all" | "act" | "read" | "watch";
type PlaygroundUiState = {
  sidebarOpen: boolean;
  category: Category;
  createDialogOpen: boolean;
  setSidebarOpen(open: boolean): void;
  setCategory(category: Category): void;
  setCreateDialogOpen(open: boolean): void;
};
export const usePlaygroundUi = create<PlaygroundUiState>((set) => ({
  sidebarOpen: true,
  category: "all",
  createDialogOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setCategory: (category) => set({ category }),
  setCreateDialogOpen: (createDialogOpen) => set({ createDialogOpen }),
}));
