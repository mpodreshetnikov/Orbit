import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TreeView, type TreeDataItem } from "./tree-view";

const TREE_DATA: TreeDataItem[] = [
  {
    id: "parent-1",
    name: "Parent",
    draggable: true,
    droppable: true,
    children: [
      {
        id: "child-1",
        name: "Child",
        draggable: true,
        droppable: true,
      },
    ],
  },
];

describe("TreeView", () => {
  it("selects node/leaf and notifies selection changes", () => {
    const onSelectChange = vi.fn();
    render(
      <TreeView data={TREE_DATA} initialSelectedItemId="child-1" onSelectChange={onSelectChange} />,
    );

    fireEvent.click(screen.getByText("Parent"));
    expect(onSelectChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "parent-1", name: "Parent" }),
    );

    const child = screen.queryByText("Child");
    if (!child) {
      // First click can keep the node collapsed depending on initial accordion state.
      fireEvent.click(screen.getByText("Parent"));
    }

    fireEvent.click(screen.getByText("Child"));
    expect(onSelectChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "child-1", name: "Child" }),
    );
  });

  it("calls onDocumentDrag when dragging onto a different item", () => {
    const onDocumentDrag = vi.fn();
    render(
      <TreeView data={TREE_DATA} initialSelectedItemId="child-1" onDocumentDrag={onDocumentDrag} />,
    );

    const dataTransfer = { setData: vi.fn() } as unknown as DataTransfer;
    const parent = screen.getByText("Parent");
    const child = screen.getByText("Child");

    fireEvent.dragStart(child, { dataTransfer });
    fireEvent.dragOver(parent, { dataTransfer });
    fireEvent.drop(parent, { dataTransfer });

    expect(onDocumentDrag).toHaveBeenCalledWith(
      expect.objectContaining({ id: "child-1" }),
      expect.objectContaining({ id: "parent-1" }),
    );
  });

  it("renders via custom renderItem callback", () => {
    render(
      <TreeView
        data={TREE_DATA}
        initialSelectedItemId="child-1"
        renderItem={({ item, isLeaf, level }) => (
          <span>{`${item.name}-${isLeaf ? "leaf" : "node"}-${level}`}</span>
        )}
      />,
    );

    expect(screen.getByText("Parent-node-0")).toBeInTheDocument();
    expect(screen.getByText("Child-leaf-1")).toBeInTheDocument();
  });
});
