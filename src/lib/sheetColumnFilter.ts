// スプレッドシート式の列見出しフィルタ(SheetColumnFilter)の判定ロジック。表ごとの違いは cellOf(行→セル値) と compareValues だけ。
import type { SheetColumnFilterOption, SheetSortDirection } from '../components/SheetColumnFilter'

// value はフィルタ・並べ替えのキー、label はフィルタ一覧に出す表示値。
export type SheetCell = { value: string; label: string }
export type SheetColumnFilters<ColumnKey extends string> = Partial<Record<ColumnKey, string[]>>
export type SheetSort<ColumnKey extends string> = { columnKey: ColumnKey; direction: SheetSortDirection } | null

const BLANK_FILTER_LABEL = '(空白)'

export function sheetCell(text: string | null | undefined): SheetCell {
  const value = text ?? ''
  return { value, label: value }
}

export function compareTextValues(leftValue: string, rightValue: string): number {
  return leftValue.localeCompare(rightValue, 'ja')
}

// 空白は昇順・降順どちらでも末尾に置く(スプレッドシートと同じ)。
export function compareSheetValues(leftValue: string, rightValue: string, compareValues: (left: string, right: string) => number, direction: SheetSortDirection = 'asc'): number {
  if (leftValue === rightValue) return 0
  if (leftValue === '') return 1
  if (rightValue === '') return -1
  return (direction === 'asc' ? 1 : -1) * compareValues(leftValue, rightValue)
}

export function matchesSheetColumnFilters<Row, ColumnKey extends string>(
  row: Row,
  columnFilters: SheetColumnFilters<ColumnKey>,
  cellOf: (row: Row, columnKey: ColumnKey) => SheetCell,
  ignoredColumnKey?: ColumnKey,
): boolean {
  return (Object.entries(columnFilters) as [ColumnKey, string[] | undefined][]).every(([columnKey, selectedValues]) => {
    if (columnKey === ignoredColumnKey || !selectedValues) return true
    return selectedValues.includes(cellOf(row, columnKey).value)
  })
}

// フィルタ一覧の候補は「他の列のフィルタを通った行」の値(Excel のオートフィルタと同じ)。選択中の値は件数0でも残す。
export function sheetColumnFilterOptions<Row, ColumnKey extends string>(
  rows: Row[],
  columnFilters: SheetColumnFilters<ColumnKey>,
  columnKey: ColumnKey,
  cellOf: (row: Row, columnKey: ColumnKey) => SheetCell,
  compareValues: (left: string, right: string) => number,
): SheetColumnFilterOption[] {
  const optionsByValue = new Map<string, SheetColumnFilterOption>()
  for (const row of rows) {
    if (!matchesSheetColumnFilters(row, columnFilters, cellOf, columnKey)) continue
    const cell = cellOf(row, columnKey)
    const existingOption = optionsByValue.get(cell.value)
    if (existingOption) existingOption.count += 1
    else optionsByValue.set(cell.value, { value: cell.value, label: cell.label || BLANK_FILTER_LABEL, count: 1 })
  }
  for (const selectedValue of columnFilters[columnKey] ?? []) {
    if (!optionsByValue.has(selectedValue)) optionsByValue.set(selectedValue, { value: selectedValue, label: selectedValue || BLANK_FILTER_LABEL, count: 0 })
  }
  return [...optionsByValue.values()].sort((left, right) => compareSheetValues(left.value, right.value, compareValues))
}

// フィルタ適用 → 並べ替え。sort が無いとき・同値のときは fallbackCompare の順。
export function filterAndSortSheetRows<Row, ColumnKey extends string>(
  rows: Row[],
  columnFilters: SheetColumnFilters<ColumnKey>,
  sort: SheetSort<ColumnKey>,
  cellOf: (row: Row, columnKey: ColumnKey) => SheetCell,
  compareValuesOf: (columnKey: ColumnKey) => (left: string, right: string) => number,
  fallbackCompare: (left: Row, right: Row) => number,
): Row[] {
  const filteredRows = rows.filter((row) => matchesSheetColumnFilters(row, columnFilters, cellOf))
  if (!sort) return filteredRows.sort(fallbackCompare)
  const compareValues = compareValuesOf(sort.columnKey)
  return filteredRows.sort((left, right) =>
    compareSheetValues(cellOf(left, sort.columnKey).value, cellOf(right, sort.columnKey).value, compareValues, sort.direction) || fallbackCompare(left, right),
  )
}

export function withColumnFilter<ColumnKey extends string>(
  columnFilters: SheetColumnFilters<ColumnKey>,
  columnKey: ColumnKey,
  selectedValues: string[] | null,
): SheetColumnFilters<ColumnKey> {
  const nextColumnFilters = { ...columnFilters }
  if (selectedValues === null) delete nextColumnFilters[columnKey]
  else nextColumnFilters[columnKey] = selectedValues
  return nextColumnFilters
}
