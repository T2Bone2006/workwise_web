import { Document, Image, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { InvoiceViewModel } from '@/lib/invoices/view-model';

const ACCENT = '#0F766E';
const INK = '#1F2937';
const MUTED = '#6B7280';
const RULE = '#E5E7EB';

const STAMP_COLOR = {
  PAID: '#15803D',
  VOID: '#B91C1C',
  OVERDUE: '#B45309',
} as const;

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: INK,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  logo: {
    width: 150,
    height: 60,
    objectFit: 'contain',
    objectPosition: 'left',
  },
  sellerFallback: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 18,
    maxWidth: 280,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  title: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 22,
    color: ACCENT,
  },
  meta: {
    fontSize: 9,
    marginTop: 2,
  },
  parties: {
    flexDirection: 'row',
    marginTop: 24,
  },
  party: {
    width: '50%',
    paddingRight: 16,
  },
  partyLabel: {
    fontSize: 8,
    color: MUTED,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  bold: {
    fontFamily: 'Helvetica-Bold',
  },
  line: {
    fontSize: 9,
    marginTop: 1,
  },
  vatLine: {
    fontSize: 9,
    marginTop: 4,
  },
  table: {
    marginTop: 24,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    paddingBottom: 4,
    marginBottom: 2,
  },
  th: {
    fontSize: 8,
    color: MUTED,
  },
  dateCol: { width: 70 },
  amountCol: { width: 70, textAlign: 'right' },
  descCol: { flex: 1, paddingRight: 8 },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    paddingVertical: 6,
  },
  desc: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
  },
  address: {
    fontSize: 8,
    color: MUTED,
    marginTop: 1,
  },
  totals: {
    marginTop: 12,
    marginLeft: 'auto',
    width: 200,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  balanceLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    color: ACCENT,
  },
  balanceValue: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    color: ACCENT,
  },
  stamp: {
    position: 'absolute',
    top: 168,
    right: 48,
    fontFamily: 'Helvetica-Bold',
    fontSize: 28,
    opacity: 0.4,
    transform: 'rotate(-12deg)',
  },
  payBox: {
    marginTop: 22,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 6,
  },
  payHeading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    color: ACCENT,
    marginBottom: 8,
  },
  payCols: {
    flexDirection: 'column',
    gap: 10,
  },
  payCol: {
    width: '100%',
  },
  payLink: {
    fontSize: 8,
    color: ACCENT,
    maxWidth: '100%',
  },
  payLinkText: {
    fontSize: 8,
    color: ACCENT,
    maxWidth: 480,
  },
  payLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    marginBottom: 3,
  },
  bankLine: {
    fontSize: 9,
    marginTop: 1,
  },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 8,
    color: MUTED,
  },
});

export type InvoiceLogo = { data: Buffer; format: 'png' | 'jpg' } | null;

/** Long URLs have no spaces — break on punctuation and every ~16 chars. */
function softWrap(text: string): string {
  const withBreaks = text.replace(/([/?&=._%+-])/g, '$1\u200b');
  if (withBreaks.length < 24) return withBreaks;
  return withBreaks.replace(/([^\u200b]{16})/g, '$1\u200b');
}

export function invoiceDocument(vm: InvoiceViewModel, logo: InvoiceLogo) {
  const dueLine =
    vm.dueDate === vm.issueDate ? 'Due on receipt' : `Due ${vm.dueDate}`;
  const showPay = Boolean(vm.howToPay.cardUrl || vm.howToPay.bankLines);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {vm.stamp ? (
          <Text style={[styles.stamp, { color: STAMP_COLOR[vm.stamp] }]}>{vm.stamp}</Text>
        ) : null}

        <View style={styles.header}>
          {logo ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image src={{ data: logo.data, format: logo.format }} style={styles.logo} />
            </>
          ) : (
            <Text style={styles.sellerFallback}>{vm.seller.name}</Text>
          )}
          <View style={styles.headerRight}>
            <Text style={styles.title}>{vm.title}</Text>
            <Text style={styles.meta}>Invoice no. {vm.number}</Text>
            <Text style={styles.meta}>Date {vm.issueDate}</Text>
            <Text style={styles.meta}>{dueLine}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>From</Text>
            <Text style={styles.bold}>{vm.seller.name}</Text>
            {vm.seller.lines.map((line) => (
              <Text key={line} style={styles.line}>
                {softWrap(line)}
              </Text>
            ))}
            {vm.seller.vatLine ? <Text style={styles.vatLine}>{vm.seller.vatLine}</Text> : null}
          </View>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>Bill to</Text>
            {vm.billTo.lines.map((line, index) => (
              <Text key={`${line}-${index}`} style={index === 0 ? styles.bold : styles.line}>
                {softWrap(line)}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.table}>
          <View fixed style={styles.tableHeader}>
            <Text style={[styles.th, styles.dateCol]}>DATE</Text>
            <Text style={[styles.th, styles.descCol]}>DESCRIPTION</Text>
            <Text style={[styles.th, styles.amountCol]}>AMOUNT</Text>
          </View>
          {vm.rows.map((row, index) => (
            <View key={`${row.date}-${row.description}-${index}`} wrap={false} style={styles.row}>
              <Text style={styles.dateCol}>{row.date}</Text>
              <View style={styles.descCol}>
                <Text style={styles.desc}>{row.description}</Text>
                {row.address ? <Text style={styles.address}>{row.address}</Text> : null}
              </View>
              <Text style={styles.amountCol}>{row.amount}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          {vm.totals.map((row) => (
            <View key={row.label} style={styles.totalRow}>
              <Text style={row.strong ? styles.balanceLabel : undefined}>{row.label}</Text>
              <Text style={row.strong ? styles.balanceValue : undefined}>{row.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.payBox} wrap={false}>
          <Text style={styles.payHeading}>How to pay</Text>
          {showPay ? (
            <View style={styles.payCols}>
              {vm.howToPay.cardUrl ? (
                <View style={styles.payCol}>
                  <Text style={styles.payLabel}>Pay online</Text>
                  <Link src={vm.howToPay.cardUrl} style={styles.payLink}>
                    <Text style={styles.payLinkText}>{softWrap(vm.howToPay.cardUrl)}</Text>
                  </Link>
                </View>
              ) : null}
              {vm.howToPay.bankLines ? (
                <View style={styles.payCol}>
                  <Text style={styles.payLabel}>Bank transfer</Text>
                  {vm.howToPay.bankLines.map((line) => (
                    <Text key={line.label} style={styles.bankLine}>
                      {line.label}: {line.value}
                    </Text>
                  ))}
                  {vm.howToPay.reference ? (
                    <Text style={[styles.bankLine, styles.bold]}>
                      Reference: {vm.howToPay.reference}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : (
            <Text>Please contact us to pay.</Text>
          )}
        </View>

        <View fixed style={styles.footer}>
          {vm.footer ? <Text>{vm.footer}</Text> : null}
          <Text
            render={({ pageNumber, totalPages }) =>
              `${vm.seller.name} · Invoice ${vm.number} · Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
