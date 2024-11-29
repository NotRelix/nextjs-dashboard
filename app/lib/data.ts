import { sql } from '@vercel/postgres';
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  Revenue,
} from './definitions';
import { formatCurrency } from './utils';
import { supabase } from './supabase';

export async function fetchRevenue() {
  try {
    const { data, error } = await supabase.from('revenue').select('*');

    if (error) {
      console.error('Supabase Query Error:', error);
      throw new Error(error.message);
    }

    console.log('Fetched Revenue Data:', data);
    return data;
  } catch (error) {
    console.error('Fetch Revenue Error:', error);
    throw new Error('Failed to fetch revenue data.');
  }
}

export async function fetchLatestInvoices() {
  try {
    // const data = await sql<LatestInvoiceRaw>`
    //   SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
    //   FROM invoices
    //   JOIN customers ON invoices.customer_id = customers.id
    //   ORDER BY invoices.date DESC
    //   LIMIT 5`;
    const { data, error } = await supabase
      .from('invoices')
      .select(`
        amount,
        id,
        date,
        customer_id,
        customers (
          name,
          image_url,
          email
        )
      `)
      .order('date', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Error fetching latest invoices', error);
      throw error;
    }

    const latestInvoices = data.map((invoice) => {
      const customer = Array.isArray(invoice.customers) ? invoice.customers[0] : invoice.customers;
    
      return {
        ...invoice,
        amount: formatCurrency(invoice.amount),
        name: customer?.name,
        image_url: customer?.image_url,
        email: customer?.email
      };
    });

    console.log("Fetched Latest Invoices", latestInvoices)
    return latestInvoices;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch the latest invoices.');
  }
}

export async function fetchCardData() {
  try {
    // You can probably combine these into a single SQL query
    // However, we are intentionally splitting them to demonstrate
    // how to initialize multiple queries in parallel with JS.

    const { data: invoiceData, error: invoiceError, count: invoiceCount } = await supabase
      .from('invoices')
      .select('*', { count: 'exact' })

    if (invoiceError) {
      console.error('Error fetching invoice count:', invoiceError)
    } else {
      console.log('Invoice count:', invoiceCount)
    }

    const { data: customerData, error: customerError, count: customerCount } = await supabase
      .from('customers')
      .select('*', { count: 'exact' })

    if (customerError) {
      console.error('Error fetching customer count:', customerError)
    } else {
      console.log('Customer count', customerCount)
    }

    let paidTotal = 0
    let pendingTotal = 0

    const { data: invoiceStatusData, error: invoiceStatusError } = await supabase
      .from('invoices')
      .select('amount, status')
      .in('status', ['paid', 'pending'])

    if (invoiceStatusError) {
      console.error('Error fetching invoice status data:', invoiceStatusError)
    } else {
      const paid = invoiceStatusData
        .filter((invoice) => invoice.status === 'paid')
        .reduce((sum, invoice) => sum + parseFloat(invoice.amount), 0);

      const pending = invoiceStatusData
        .filter((invoice) => invoice.status === 'pending')
        .reduce((sum, invoice) => sum + parseFloat(invoice.amount), 0);

      paidTotal = paid
      pendingTotal = pending
    }
    
    return {
      numberOfCustomers: Number(customerCount ?? '0'),
      numberOfInvoices: Number(invoiceCount ?? '0'),
      totalPaidInvoices: formatCurrency(paidTotal),
      totalPendingInvoices: formatCurrency(pendingTotal),
    };
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch card data.');
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    const invoices = await sql<InvoicesTable>`
      SELECT
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`} OR
        invoices.amount::text ILIKE ${`%${query}%`} OR
        invoices.date::text ILIKE ${`%${query}%`} OR
        invoices.status ILIKE ${`%${query}%`}
      ORDER BY invoices.date DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;

    return invoices.rows;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  }
}

export async function fetchInvoicesPages(query: string) {
  try {
    const count = await sql`SELECT COUNT(*)
    FROM invoices
    JOIN customers ON invoices.customer_id = customers.id
    WHERE
      customers.name ILIKE ${`%${query}%`} OR
      customers.email ILIKE ${`%${query}%`} OR
      invoices.amount::text ILIKE ${`%${query}%`} OR
      invoices.date::text ILIKE ${`%${query}%`} OR
      invoices.status ILIKE ${`%${query}%`}
  `;

    const totalPages = Math.ceil(Number(count.rows[0].count) / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch total number of invoices.');
  }
}

export async function fetchInvoiceById(id: string) {
  try {
    const data = await sql<InvoiceForm>`
      SELECT
        invoices.id,
        invoices.customer_id,
        invoices.amount,
        invoices.status
      FROM invoices
      WHERE invoices.id = ${id};
    `;

    const invoice = data.rows.map((invoice) => ({
      ...invoice,
      // Convert amount from cents to dollars
      amount: invoice.amount / 100,
    }));

    return invoice[0];
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoice.');
  }
}

export async function fetchCustomers() {
  try {
    const data = await sql<CustomerField>`
      SELECT
        id,
        name
      FROM customers
      ORDER BY name ASC
    `;

    const customers = data.rows;
    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch all customers.');
  }
}

export async function fetchFilteredCustomers(query: string) {
  try {
    const data = await sql<CustomersTableType>`
		SELECT
		  customers.id,
		  customers.name,
		  customers.email,
		  customers.image_url,
		  COUNT(invoices.id) AS total_invoices,
		  SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
		  SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
		FROM customers
		LEFT JOIN invoices ON customers.id = invoices.customer_id
		WHERE
		  customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`}
		GROUP BY customers.id, customers.name, customers.email, customers.image_url
		ORDER BY customers.name ASC
	  `;

    const customers = data.rows.map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch customer table.');
  }
}
