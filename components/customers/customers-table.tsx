'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search,
  Plus,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  X,
  Building2,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CustomerListRow } from '@/lib/data/customers';
import { deleteCustomer } from '@/lib/actions/customers';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 300;
type SortCol = 'name' | 'email' | 'jobs';
type SortDir = 'asc' | 'desc';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'bulk_client', label: 'Bulk Client' },
  { value: 'individual', label: 'Individual' },
] as const;

function TypeBadge({ type }: { type: string }) {
  const isBulk = type === 'bulk_client';
  const label = isBulk ? 'Bulk Client' : 'Individual';
  const icon = isBulk ? Building2 : User;
  const Icon = icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur-sm',
            isBulk
              ? 'border-violet-400/60 bg-violet-500/10 text-violet-700 dark:text-violet-400 shadow-[0_0_12px_-2px_rgba(139,92,246,0.3)]'
              : 'border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 shadow-[0_0_10px_-2px_rgba(16,185,129,0.25)]'
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {isBulk ? 'Submits bulk jobs via CSV' : 'One-off / single job requests'}
      </TooltipContent>
    </Tooltip>
  );
}

export interface CustomersTableProps {
  customers: CustomerListRow[];
  initialSearch: string;
  initialTypeFilter: 'all' | 'bulk_client' | 'individual';
  initialSort: SortCol;
  initialSortDir: SortDir;
  fetchError: Error | null;
}

export function CustomersTable({
  customers,
  initialSearch,
  initialTypeFilter,
  initialSort,
  initialSortDir,
  fetchError,
}: CustomersTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>(initialSort);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      router.push(`/customers?${next.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    setSearchInput(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    if (fetchError) {
      toast.error('Failed to load customers', { description: fetchError.message });
    }
  }, [fetchError]);

  useEffect(() => {
    const t = setTimeout(() => {
      const current = searchParams.get('search') ?? '';
      if (searchInput.trim() !== current) {
        updateParams({ search: searchInput.trim() || undefined });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput, updateParams, searchParams]);

  const sortedCustomers = useMemo(() => {
    const list = [...customers];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'name') {
        cmp = (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' });
      } else if (sortCol === 'email') {
        cmp = (a.email ?? '').localeCompare(b.email ?? '', undefined, { sensitivity: 'base' });
      } else {
        cmp = (a.job_count ?? 0) - (b.job_count ?? 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [customers, sortCol, sortDir]);

  const toggleSort = (col: SortCol) => {
    const nextDir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc';
    setSortCol(col);
    setSortDir(nextDir);
  };

  const SortIcon = ({ column }: { column: SortCol }) => {
    if (sortCol !== column) return <ArrowUpDown className="size-3.5 ml-0.5 opacity-50" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="size-3.5 ml-0.5" />
    ) : (
      <ArrowDown className="size-3.5 ml-0.5" />
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.size >= sortedCustomers.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(sortedCustomers.map((c) => c.id)));
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleDeleteOne = async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    const result = await deleteCustomer(deleteConfirmId);
    setIsDeleting(false);
    setDeleteConfirmId(null);
    if (result.success) {
      toast.success('Customer deleted');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete customer');
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    setIsDeleting(true);
    let ok = 0;
    let withJobs = 0;
    for (const id of selectedIds) {
      const result = await deleteCustomer(id);
      if (result.success) ok++;
      else if (result.error?.includes('existing jobs')) withJobs++;
    }
    setIsDeleting(false);
    setBulkDeleteOpen(false);
    setSelectedIds(new Set());
    router.refresh();
    if (withJobs > 0) {
      toast.warning(`Deleted ${ok} customer(s). ${withJobs} could not be deleted (have jobs).`);
    } else {
      toast.success(`Deleted ${ok} customer(s)`);
    }
  };

  const handleExportSelected = () => {
    const selected = sortedCustomers.filter((c) => selectedIds.has(c.id));
    const headers = ['Name', 'Type', 'Email', 'Phone', 'Total Jobs'];
    const rows = selected.map((c) => [
      c.name,
      c.type,
      c.email ?? '',
      c.phone ?? '',
      String(c.job_count ?? 0),
    ]);
    const csv = [
      headers.join(','),
      ...rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Export downloaded');
  };

  const isEmpty = sortedCustomers.length === 0 && !fetchError;
  const typeFilterValue = initialTypeFilter === 'all' ? 'all' : initialTypeFilter;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <Card
          className={cn(
            'glass-card overflow-hidden border-border/80 transition-all duration-300',
            'dark:border-white/[0.06]',
            'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          <CardContent className="p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[180px] sm:max-w-[260px]">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Name, email, phone..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-9"
                    aria-label="Search customers"
                  />
                </div>
                <Select
                  value={typeFilterValue}
                  onValueChange={(v) =>
                    updateParams({
                      type: v === 'all' ? undefined : v,
                    })
                  }
                >
                  <SelectTrigger className="w-[160px]" size="default">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="gradient"
                  size="default"
                  className="ml-auto shadow-[var(--shadow-btn-glow-value)]"
                  asChild
                >
                  <Link href="/customers/new" className="gap-2">
                    <Plus className="size-4" />
                    Add Customer
                  </Link>
                </Button>
              </div>

              {selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <span className="text-sm font-medium text-foreground">
                    {selectedIds.size} selected
                  </span>
                  <Button variant="outline" size="sm" onClick={handleExportSelected} className="gap-1">
                    <Download className="size-3.5" />
                    Export Selected
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete Selected
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                    <X className="size-3.5" />
                    Clear Selection
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {isEmpty ? (
          <Card
            className={cn(
              'glass-card overflow-hidden border-border/80',
              'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
            )}
          >
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                <Building2 className="size-8 text-primary" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">No customers yet</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Add your first customer to start creating jobs
              </p>
              <Button
                variant="gradient"
                size="lg"
                className="mt-6 shadow-[var(--shadow-btn-glow-value)]"
                asChild
              >
                <Link href="/customers/new" className="gap-2">
                  <Plus className="size-4" />
                  Add Customer
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card
            className={cn(
              'glass-card overflow-hidden border-border/80 transition-all duration-300',
              'dark:border-white/[0.06]',
              'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
            )}
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/80 hover:bg-transparent">
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === sortedCustomers.length && sortedCustomers.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-border"
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        className="inline-flex items-center font-medium"
                        onClick={() => toggleSort('name')}
                      >
                        Name
                        <SortIcon column="name" />
                      </button>
                    </TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        className="inline-flex items-center font-medium"
                        onClick={() => toggleSort('email')}
                      >
                        Email
                        <SortIcon column="email" />
                      </button>
                    </TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        className="inline-flex items-center font-medium"
                        onClick={() => toggleSort('jobs')}
                      >
                        Total Jobs
                        <SortIcon column="jobs" />
                      </button>
                    </TableHead>
                    <TableHead className="w-[80px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCustomers.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        'border-border/80',
                        row.type === 'bulk_client' && 'bg-violet-500/[0.03] dark:bg-violet-500/[0.06]'
                      )}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          className="rounded border-border"
                          aria-label={`Select ${row.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/customers/${row.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {row.name || '—'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <TypeBadge type={row.type ?? 'individual'} />
                      </TableCell>
                      <TableCell>
                        {row.email ? (
                          <a
                            href={`mailto:${row.email}`}
                            className="text-primary hover:underline"
                          >
                            {row.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.phone ? (
                          <a href={`tel:${row.phone}`} className="text-primary hover:underline">
                            {row.phone}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.job_count > 0 ? (
                          <Link
                            href={`/jobs?customer_id=${row.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {row.job_count}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreHorizontal className="size-4" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/customers/${row.id}`} className="gap-2">
                                <Eye className="size-3.5" />
                                View
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/customers/${row.id}/edit`} className="gap-2">
                                <Pencil className="size-3.5" />
                                Edit
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteConfirmId(row.id)}
                            >
                              <Trash2 className="size-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}

        <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete customer?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. Customers with existing jobs cannot be deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteOne}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete selected customers?</DialogTitle>
              <DialogDescription>
                Customers with existing jobs will not be deleted. Others will be removed permanently.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : `Delete ${selectedIds.size} customer(s)`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

