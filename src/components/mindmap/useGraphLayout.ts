import { useMemo } from 'react'
import { BRANCH_COLORS } from './types'
import type { GraphNode } from './types'

// マインドマップの「横向きツリー配置」の計算だけを担うフック（描画はしない）。
// x=深さ, y=葉の並び順。親のyは子の中点。折りたたんだ枝の子孫は配置しない。

export type GraphMetrics = {
  colW: number
  rowH: number
  boxW: number
  boxH: number
  padX: number
  padY: number
}

export type GraphEdge = { id: string; d: string; child: number }

export function useGraphLayout(nodes: GraphNode[], collapsedIds: Set<number>, videoMode: boolean) {
  // 寸法（動画用は大きめ＆余白広め）。通常も3行入る高さ・広めの行間で読みやすく。
  const metrics: GraphMetrics = useMemo(() => {
    const colW = videoMode ? 300 : 250
    return {
      colW,
      rowH: videoMode ? 104 : 76,
      boxW: colW - (videoMode ? 64 : 46),
      boxH: videoMode ? 72 : 58,
      padX: 24,
      padY: 24,
    }
  }, [videoMode])

  // keyword はリスト表示同様グラフでも省く
  const visibleNodes = useMemo(() => nodes.filter((node) => node.kind !== 'keyword'), [nodes])

  const childrenOf = useMemo(() => {
    const byParent = new Map<number | null, GraphNode[]>()
    visibleNodes.forEach((node) => {
      const siblings = byParent.get(node.parent_id) ?? []
      siblings.push(node)
      byParent.set(node.parent_id, siblings)
    })
    byParent.forEach((siblings) => siblings.sort((a, b) => a.position - b.position || a.id - b.id))
    return byParent
  }, [visibleNodes])

  // 子孫ノード数（折りたたみバッジの「+N」表示用）
  const descendantCount = useMemo(() => {
    const memo = new Map<number, number>()
    const count = (id: number): number => {
      if (memo.has(id)) return memo.get(id)!
      const kids = childrenOf.get(id) ?? []
      const total = kids.reduce((acc, kid) => acc + 1 + count(kid.id), 0)
      memo.set(id, total)
      return total
    }
    visibleNodes.forEach((node) => count(node.id))
    return memo
  }, [childrenOf, visibleNodes])

  const { pos, width, height, order, branchOf } = useMemo(() => {
    const pos = new Map<number, { x: number; y: number; depth: number }>()
    const branchOf = new Map<number, number>() // 第1階層の枝 index（色分け用）
    const order: number[] = [] // 展開アニメ用の表示順(DFS)
    let leafRow = 0
    let maxDepth = 0
    const layout = (node: GraphNode, depth: number, branch: number): number => {
      maxDepth = Math.max(maxDepth, depth)
      order.push(node.id)
      branchOf.set(node.id, branch)
      const kids = collapsedIds.has(node.id) ? [] : (childrenOf.get(node.id) ?? [])
      const x = metrics.padX + depth * metrics.colW
      if (kids.length === 0) {
        const y = metrics.padY + leafRow * metrics.rowH
        leafRow++
        pos.set(node.id, { x, y, depth })
        return y
      }
      const ys = kids.map((kid, index) => layout(kid, depth + 1, depth === 0 ? index : branch))
      const y = (ys[0] + ys[ys.length - 1]) / 2
      pos.set(node.id, { x, y, depth })
      return y
    }
    const roots = childrenOf.get(null) ?? []
    roots.forEach((root, index) => layout(root, 0, index))
    const width = metrics.padX * 2 + (maxDepth + 1) * metrics.colW
    const height = metrics.padY * 2 + Math.max(1, leafRow) * metrics.rowH
    return { pos, width, height, order, branchOf }
  }, [childrenOf, collapsedIds, metrics])

  // 親→子を繋ぐ曲線コネクタ（SVG パス）
  const edges = useMemo(() => {
    const list: GraphEdge[] = []
    visibleNodes.forEach((node) => {
      if (node.parent_id == null) return
      const parentPos = pos.get(node.parent_id)
      const childPos = pos.get(node.id)
      if (!parentPos || !childPos) return
      const x1 = parentPos.x + metrics.boxW, y1 = parentPos.y + metrics.boxH / 2
      const x2 = childPos.x, y2 = childPos.y + metrics.boxH / 2
      const mx = (x1 + x2) / 2
      list.push({ id: `${node.parent_id}-${node.id}`, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, child: node.id })
    })
    return list
  }, [visibleNodes, pos, metrics])

  const branchColor = (id: number) => BRANCH_COLORS[(branchOf.get(id) ?? 0) % BRANCH_COLORS.length]

  return { metrics, visibleNodes, childrenOf, descendantCount, pos, width, height, order, edges, branchColor }
}
