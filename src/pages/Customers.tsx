import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Upload, UserPlus, FileSpreadsheet, X, Check, AlertCircle, CalendarIcon, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingContext } from "@/contexts/OnboardingContext";
import { useDomainWarming } from "@/hooks/useDomainWarming";
import DomainWarmingBanner from "@/components/DomainWarmingBanner";

interface ParsedCustomer {
  first_name: string;
  last_name: string;
  firm_name: string;
  email: string;
  custom_fields: Record<string, string>;
  isValid: boolean;
  errors: string[];
}

export default function Customers() {
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    firm_name: "",
    email: "",
    sequence_id: "",
    notes: "",
  });
  
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [sendImmediately, setSendImmediately] = useState(true);
  
  const [parsedCustomers, setParsedCustomers] = useState<ParsedCustomer[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkSendMode, setBulkSendMode] = useState<"sequence" | "direct">("sequence");
  const [bulkSequenceId, setBulkSequenceId] = useState("");
  const [bulkDirectSubject, setBulkDirectSubject] = useState("");
  const [bulkDirectBody, setBulkDirectBody] = useState("");
  const [bulkScheduledDate, setBulkScheduledDate] = useState<Date | undefined>(undefined);
  const [bulkScheduledTime, setBulkScheduledTime] = useState("09:00");
  const [bulkSendImmediately, setBulkSendImmediately] = useState(true);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [bulkCustomFieldOverrides, setBulkCustomFieldOverrides] = useState<Record<number, Record<string, string>>>({});

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, organizationId } = useAuth();
  const { completeStep } = useOnboardingContext();
  const { data: domainWarming } = useDomainWarming();

  const { data: sequences } = useQuery({
    queryKey: ["sequences", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences")
        .select("*")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: steps } = useQuery({
    queryKey: ["all-steps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sequence_steps")
        .select("*")
        .order("step_order");
      if (error) throw error;
      return data;
    },
  });

  const BUILTIN_PLACEHOLDERS = new Set([
    "first name", "last name", "full name", "name", "firm name",
    "company", "company name", "email",
    "insert name", "insert first name", "insert last name",
    "your name", "their name", "client name",
  ]);

  const isBuiltinPlaceholder = (name: string) =>
    BUILTIN_PLACEHOLDERS.has(name.toLowerCase().trim());

  const extractCustomFields = (stepsData: any[] | undefined) => {
    if (!stepsData) return [];
    const placeholders = new Set<string>();
    for (const step of stepsData) {
      const template = (step as any).email_templates;
      if (!template) continue;
      const text = `${template.subject || ""} ${template.body || ""}`;
      for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
        if (!isBuiltinPlaceholder(match[1])) {
          placeholders.add(match[1]);
        }
      }
    }
    return Array.from(placeholders).sort();
  };

  // Fetch templates for single-customer sequence
  const { data: sequenceTemplates } = useQuery({
    queryKey: ["sequence-templates", formData.sequence_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sequence_steps")
        .select("*, email_templates(subject, body)")
        .eq("sequence_id", formData.sequence_id)
        .order("step_order");
      if (error) throw error;
      return data;
    },
    enabled: !!formData.sequence_id,
  });

  const requiredCustomFields = useMemo(() => extractCustomFields(sequenceTemplates), [sequenceTemplates]);

  // Fetch templates for bulk-import sequence
  const { data: bulkSequenceTemplates } = useQuery({
    queryKey: ["sequence-templates", bulkSequenceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sequence_steps")
        .select("*, email_templates(subject, body)")
        .eq("sequence_id", bulkSequenceId)
        .order("step_order");
      if (error) throw error;
      return data;
    },
    enabled: !!bulkSequenceId,
  });

  const bulkRequiredCustomFields = useMemo(() => {
    if (bulkSendMode === "direct") {
      const text = `${bulkDirectSubject} ${bulkDirectBody}`;
      const placeholders = new Set<string>();
      for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
        if (!isBuiltinPlaceholder(match[1])) placeholders.add(match[1]);
      }
      return Array.from(placeholders).sort();
    }
    return extractCustomFields(bulkSequenceTemplates);
  }, [bulkSendMode, bulkDirectSubject, bulkDirectBody, bulkSequenceTemplates]);

  // Reset custom field values when sequence changes
  useEffect(() => {
    setCustomFieldValues({});
  }, [formData.sequence_id]);

  const triggerEmailProcessing = async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      await fetch(`${supabaseUrl}/functions/v1/process-emails`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      console.error("Failed to trigger email processing:", err);
    }
  };

  const checkEmailAllowance = async (emailCount: number) => {
    if (!organizationId) return;
    const { data: allowance } = await supabase.rpc("check_email_allowance", { org_id: organizationId });
    if (allowance) {
      const remaining = Math.max(0, allowance.limit - allowance.used);
      if (emailCount > remaining) {
        toast({
          title: "Email limit warning",
          description: `You have ${remaining} email${remaining !== 1 ? "s" : ""} remaining this month. Scheduling ${emailCount} may cause some to fail.`,
          variant: "destructive",
        });
      }
    }
  };

  const checkDomainWarming = async (emailCount: number) => {
    if (!organizationId) return;
    const { data } = await (supabase as any).rpc("check_domain_warming_status", { org_id: organizationId });
    const overLimit = (data || []).filter((d: any) => d.is_over_limit);
    if (overLimit.length > 0) {
      const domainList = overLimit
        .map((d: any) => `${d.domain} (${d.today_sent + emailCount}/${d.recommended_limit} today)`)
        .join(", ");
      toast({
        title: "Domain warming warning",
        description: `Sending ${emailCount} more email${emailCount !== 1 ? "s" : ""} may hurt deliverability for: ${domainList}. Your domain is still warming up.`,
      });
    }
  };

  const getScheduledDateTime = (date: Date | undefined, time: string, immediate: boolean): Date => {
    if (immediate) {
      return new Date();
    }
    
    const scheduledFor = date ? new Date(date) : new Date();
    const [hours, minutes] = time.split(":").map(Number);
    scheduledFor.setHours(hours || 9, minutes || 0, 0, 0);
    
    if (scheduledFor < new Date()) {
      return new Date();
    }
    return scheduledFor;
  };

  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      // Check for duplicate email in pipeline
      if (formData.email && organizationId) {
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("email", formData.email.trim().toLowerCase())
          .eq("organization_id", organizationId)
          .limit(1);
        if (existing && existing.length > 0) {
          throw new Error("This email is already in your pipeline.");
        }
      }

      // Warn if scheduling would exceed email limit or domain warming threshold
      if (formData.sequence_id) {
        await checkEmailAllowance(1);
        await checkDomainWarming(1);
      }

      const firstStep = steps?.find(
        (s) => s.sequence_id === formData.sequence_id && s.step_order === 0
      );

      const { data: customer, error } = await supabase
        .from("customers")
        .insert({
          first_name: formData.first_name,
          last_name: formData.last_name,
          firm_name: formData.firm_name,
          email: formData.email,
          sequence_id: formData.sequence_id || null,
          current_step_id: firstStep?.id || null,
          custom_fields: Object.keys(customFieldValues).length > 0 ? customFieldValues : null,
          notes: formData.notes || null,
          status: "new",
          user_id: user?.id ?? null,
          organization_id: organizationId ?? null,
        })
        .select()
        .single();

      if (error) throw error;

      if (firstStep && customer) {
        const scheduledFor = getScheduledDateTime(scheduledDate, scheduledTime, sendImmediately);
        
        const { error: scheduleError } = await supabase.from("scheduled_sends").insert({
          customer_id: customer.id,
          step_id: firstStep.id,
          scheduled_for: scheduledFor.toISOString(),
          status: "pending",
        });
        if (scheduleError) console.error("Failed to schedule first email:", scheduleError);
        
        if (sendImmediately) {
          setTimeout(() => {
            triggerEmailProcessing();
          }, 500);
        }
      }

      return customer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setFormData({
        first_name: "",
        last_name: "",
        firm_name: "",
        email: "",
        sequence_id: "",
        notes: "",
      });
      setCustomFieldValues({});
      setScheduledDate(undefined);
      setScheduledTime("09:00");
      setSendImmediately(true);
      toast({
        title: "Customer added successfully",
        description: sendImmediately ? "Email will be sent shortly." : "Email scheduled."
      });
      completeStep("add_prospect");
    },
    onError: (error) => {
      toast({ title: "Error adding customer", description: error.message, variant: "destructive" });
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (customers: ParsedCustomer[]) => {
      // Filter out duplicate emails (within CSV and against existing pipeline)
      const emails = customers.map((c) => c.email.trim().toLowerCase());
      const { data: existingCustomers } = await supabase
        .from("customers")
        .select("email")
        .eq("organization_id", organizationId)
        .in("email", emails);

      const existingEmails = new Set((existingCustomers || []).map((c: any) => c.email.toLowerCase()));
      const seenEmails = new Set<string>();
      const uniqueCustomers: ParsedCustomer[] = [];
      let skippedCount = 0;

      for (const c of customers) {
        const email = c.email.trim().toLowerCase();
        if (existingEmails.has(email) || seenEmails.has(email)) {
          skippedCount++;
          continue;
        }
        seenEmails.add(email);
        uniqueCustomers.push(c);
      }

      if (skippedCount > 0) {
        toast({
          title: `${skippedCount} duplicate${skippedCount > 1 ? "s" : ""} skipped`,
          description: "Emails already in your pipeline or duplicated in the CSV were excluded.",
        });
      }

      if (uniqueCustomers.length === 0) {
        throw new Error("All emails are already in your pipeline.");
      }

      // Warn if scheduling would exceed email limit or domain warming threshold
      await checkEmailAllowance(uniqueCustomers.length);
      await checkDomainWarming(uniqueCustomers.length);

      let sequenceId = bulkSequenceId;
      let firstStep: any = null;

      if (bulkSendMode === "direct") {
        // Create an ad-hoc template, sequence, and step for the direct message
        const { data: template, error: tplErr } = await supabase
          .from("email_templates")
          .insert({
            name: `Direct: ${bulkDirectSubject.slice(0, 50) || "Untitled"}`,
            subject: bulkDirectSubject,
            body: bulkDirectBody,
            stage: "initial",
            organization_id: organizationId,
            user_id: user?.id,
          })
          .select()
          .single();
        if (tplErr || !template) throw new Error("Failed to create email template");

        const { data: sequence, error: seqErr } = await supabase
          .from("email_sequences")
          .insert({
            name: `Direct Send – ${new Date().toLocaleDateString()}`,
            organization_id: organizationId,
            user_id: user?.id,
          })
          .select()
          .single();
        if (seqErr || !sequence) throw new Error("Failed to create sequence");

        const { data: step, error: stepErr } = await supabase
          .from("sequence_steps")
          .insert({
            sequence_id: sequence.id,
            template_id: template.id,
            step_order: 0,
            delay_days: 0,
          })
          .select()
          .single();
        if (stepErr || !step) throw new Error("Failed to create sequence step");

        sequenceId = sequence.id;
        firstStep = step;
      } else {
        firstStep = steps?.find(
          (s) => s.sequence_id === bulkSequenceId && s.step_order === 0
        );
      }

      const customersToInsert = uniqueCustomers.map((c) => ({
        first_name: c.first_name,
        last_name: c.last_name,
        firm_name: c.firm_name,
        email: c.email,
        custom_fields: Object.keys(c.custom_fields).length > 0 ? c.custom_fields : null,
        sequence_id: sequenceId || null,
        current_step_id: firstStep?.id || null,
        status: "new",
        user_id: user?.id ?? null,
        organization_id: organizationId ?? null,
      }));

      const { data: insertedCustomers, error } = await supabase
        .from("customers")
        .insert(customersToInsert)
        .select();

      if (error) throw error;

      if (firstStep && insertedCustomers) {
        const scheduledFor = getScheduledDateTime(bulkScheduledDate, bulkScheduledTime, bulkSendImmediately);

        const scheduledSends = insertedCustomers.map((customer) => ({
          customer_id: customer.id,
          step_id: firstStep.id,
          scheduled_for: scheduledFor.toISOString(),
          status: "pending",
        }));

        const { error: scheduleError } = await supabase
          .from("scheduled_sends")
          .insert(scheduledSends);
          
        if (scheduleError) console.error("Failed to schedule emails:", scheduleError);
        
        if (bulkSendImmediately) {
          // Trigger processing multiple times to handle all emails
          // (edge function may time out before finishing large batches)
          const totalEmails = insertedCustomers.length;
          const rounds = Math.ceil(totalEmails / 10);
          for (let i = 0; i < rounds; i++) {
            setTimeout(() => triggerEmailProcessing(), 500 + i * 15000);
          }
        }
      }

      return insertedCustomers;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast({
        title: `Successfully imported ${data?.length || 0} customers`,
        description: bulkSendImmediately ? "Emails will be sent shortly." : "Emails scheduled."
      });
      completeStep("add_prospect");
      // Remove only the rows that were sent, keep the rest
      const sentIndices = new Set(
        parsedCustomers
          .map((_, i) => i)
          .filter((i) => selectedRows.has(i) && isBulkRowValid(parsedCustomers[i], i))
      );
      const remaining = parsedCustomers.filter((_, i) => !sentIndices.has(i));
      if (remaining.length === 0) {
        clearBulkImport();
      } else {
        setParsedCustomers(remaining);
        setSelectedRows(new Set());
        // Rebuild custom field overrides with new indices
        const newOverrides: Record<number, Record<string, string>> = {};
        let newIdx = 0;
        parsedCustomers.forEach((_, oldIdx) => {
          if (!sentIndices.has(oldIdx)) {
            if (bulkCustomFieldOverrides[oldIdx]) {
              newOverrides[newIdx] = bulkCustomFieldOverrides[oldIdx];
            }
            newIdx++;
          }
        });
        setBulkCustomFieldOverrides(newOverrides);
      }
    },
    onError: (error) => {
      toast({ title: "Error importing customers", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCustomerMutation.mutate();
  };

  const parseCSV = (text: string): ParsedCustomer[] => {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];

    const headerLine = lines[0].toLowerCase();
    const headers = headerLine.split(",").map((h) => h.trim().replace(/"/g, ""));
    
    const firstNameIdx = headers.findIndex((h) => 
      h === "first_name" || h === "firstname" || h === "first name" || h === "first"
    );
    const lastNameIdx = headers.findIndex((h) => 
      h === "last_name" || h === "lastname" || h === "last name" || h === "last"
    );
    const firmNameIdx = headers.findIndex((h) => 
      h === "firm_name" || h === "firmname" || h === "firm name" || h === "firm" || h === "company" || h === "company_name"
    );
    const emailIdx = headers.findIndex((h) =>
      h === "email" || h === "email_address" || h === "emailaddress"
    );

    // Identify extra columns for custom_fields
    const knownIndices = new Set([firstNameIdx, lastNameIdx, firmNameIdx, emailIdx].filter((i) => i >= 0));
    const originalHeaders = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

    return lines.slice(1).map((line) => {
      const values: string[] = [];
      let current = "";
      let inQuotes = false;

      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          values.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const first_name = firstNameIdx >= 0 ? values[firstNameIdx]?.replace(/"/g, "") || "" : "";
      const last_name = lastNameIdx >= 0 ? values[lastNameIdx]?.replace(/"/g, "") || "" : "";
      const firm_name = firmNameIdx >= 0 ? values[firmNameIdx]?.replace(/"/g, "") || "" : "";
      const email = emailIdx >= 0 ? values[emailIdx]?.replace(/"/g, "") || "" : "";

      // Collect extra columns into custom_fields
      const custom_fields: Record<string, string> = {};
      headers.forEach((_, idx) => {
        if (!knownIndices.has(idx) && values[idx]) {
          const val = values[idx].replace(/"/g, "").trim();
          if (val) {
            custom_fields[originalHeaders[idx]] = val;
          }
        }
      });

      const errors: string[] = [];
      if (!first_name) errors.push("Missing first name");
      if (!last_name) errors.push("Missing last name");
      if (!firm_name) errors.push("Missing firm name");
      if (!email) errors.push("Missing email");
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format");

      return {
        first_name,
        last_name,
        firm_name,
        email,
        custom_fields,
        isValid: errors.length === 0,
        errors,
      };
    }).filter((c) => c.first_name || c.last_name || c.email);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseCSV(text);
      setParsedCustomers(parsed);
      const validIndices = new Set(
        parsed.map((c, i) => (c.isValid ? i : -1)).filter((i) => i >= 0)
      );
      setSelectedRows(validIndices);
    };
    reader.readAsText(file);
  };

  const clearBulkImport = () => {
    setParsedCustomers([]);
    setSelectedRows(new Set());
    setBulkSendMode("sequence");
    setBulkSequenceId("");
    setBulkDirectSubject("");
    setBulkDirectBody("");
    setBulkScheduledDate(undefined);
    setBulkScheduledTime("09:00");
    setBulkSendImmediately(true);
    setBulkCustomFieldOverrides({});
    setFileName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const toggleRow = (index: number) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedRows(newSelected);
  };

  const getRowCustomFields = (customer: ParsedCustomer, index: number) => ({
    ...customer.custom_fields,
    ...(bulkCustomFieldOverrides[index] || {}),
  });

  const isBulkRowValid = (c: ParsedCustomer, index: number) => {
    if (!c.isValid) return false;
    if (bulkRequiredCustomFields.length === 0) return true;
    const merged = getRowCustomFields(c, index);
    return bulkRequiredCustomFields.every((f) => merged[f]?.trim());
  };

  const getMissingCustomFields = (c: ParsedCustomer, index: number) => {
    const merged = getRowCustomFields(c, index);
    return bulkRequiredCustomFields.filter((f) => !merged[f]?.trim());
  };

  const toggleAllValid = () => {
    const validIndices = parsedCustomers
      .map((c, i) => (isBulkRowValid(c, i) ? i : -1))
      .filter((i) => i >= 0);

    const allSelected = validIndices.every((i) => selectedRows.has(i));

    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(validIndices));
    }
  };

  const updateBulkCustomField = (rowIndex: number, field: string, value: string) => {
    setBulkCustomFieldOverrides((prev) => ({
      ...prev,
      [rowIndex]: { ...(prev[rowIndex] || {}), [field]: value },
    }));
  };

  const handleBulkImport = () => {
    const customersToImport = parsedCustomers
      .map((c, i) => ({
        ...c,
        custom_fields: { ...c.custom_fields, ...(bulkCustomFieldOverrides[i] || {}) },
      }))
      .filter((c, i) => selectedRows.has(i) && isBulkRowValid(parsedCustomers[i], i));
    if (customersToImport.length === 0) {
      toast({ title: "No valid customers selected", variant: "destructive" });
      return;
    }
    bulkImportMutation.mutate(customersToImport);
  };

  const validCount = parsedCustomers.filter((c, i) => isBulkRowValid(c, i)).length;
  const selectedValidCount = parsedCustomers.filter((c, i) => selectedRows.has(i) && isBulkRowValid(c, i)).length;

  const timeOptions = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hour = h.toString().padStart(2, "0");
      const minute = m.toString().padStart(2, "0");
      const time = `${hour}:${minute}`;
      const label = format(new Date(2000, 0, 1, h, m), "h:mm a");
      timeOptions.push({ value: time, label });
    }
  }

  const formatTimeDisplay = (time: string) => {
    try {
      const [hours, minutes] = time.split(":").map(Number);
      if (isNaN(hours) || isNaN(minutes)) return time;
      return format(new Date(2000, 0, 1, hours, minutes), "h:mm a");
    } catch {
      return time;
    }
  };

  const handleTimeInput = (value: string, setter: (time: string) => void) => {
    setter(value);
  };

  const normalizeTimeOnBlur = (value: string, setter: (time: string) => void) => {
    let normalized = value.trim();
    
    const timeRegex = /^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i;
    const match = normalized.match(timeRegex);
    
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = match[2] ? parseInt(match[2], 10) : 0;
      const period = match[3]?.toLowerCase();
      
      if (period === "pm" && hours < 12) hours += 12;
      if (period === "am" && hours === 12) hours = 0;
      
      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        const formattedTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
        setter(formattedTime);
        return;
      }
    }
    
    if (!value || !normalized) {
      setter("09:00");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Add Customers</h1>
        <p className="text-muted-foreground">Add new customers to your email sequences</p>
      </div>

      {domainWarming && <DomainWarmingBanner domains={domainWarming} />}

      {parsedCustomers.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5" />
                  Import Preview: {fileName}
                </CardTitle>
                <CardDescription>
                  {validCount} valid of {parsedCustomers.length} rows • {selectedValidCount} selected for import
                  {selectedValidCount > 50 && (
                    <span className="block text-yellow-600 dark:text-yellow-400 mt-1">
                      Emails are sent in batches of ~50 and may take a few minutes to fully deliver.
                    </span>
                  )}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={clearBulkImport}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="text-sm font-medium">Send Method</label>
                <Select value={bulkSendMode} onValueChange={(v: "sequence" | "direct") => { setBulkSendMode(v); setBulkSequenceId(""); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sequence">Use Sequence</SelectItem>
                    <SelectItem value="direct">Direct Message</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {bulkSendMode === "sequence" && (
                <div>
                  <label className="text-sm font-medium">Assign to Sequence</label>
                  <Select value={bulkSequenceId} onValueChange={setBulkSequenceId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a sequence" />
                    </SelectTrigger>
                    <SelectContent>
                      {sequences?.map((sequence) => (
                        <SelectItem key={sequence.id} value={sequence.id}>
                          {sequence.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <div>
                <label className="text-sm font-medium">When to Send</label>
                <Select 
                  value={bulkSendImmediately ? "now" : "scheduled"} 
                  onValueChange={(v) => setBulkSendImmediately(v === "now")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="now">Send Immediately</SelectItem>
                    <SelectItem value="scheduled">Schedule for Later</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {!bulkSendImmediately && (
                <>
                  <div>
                    <label className="text-sm font-medium">Start Date</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !bulkScheduledDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {bulkScheduledDate ? format(bulkScheduledDate, "PPP") : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={bulkScheduledDate}
                          onSelect={setBulkScheduledDate}
                          disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium">Start Time</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left font-normal"
                        >
                          <Clock className="mr-2 h-4 w-4" />
                          {formatTimeDisplay(bulkScheduledTime)}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3" align="start">
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs text-muted-foreground">Type a time (e.g., 9:30am, 14:00)</label>
                            <Input
                              value={bulkScheduledTime}
                              onChange={(e) => handleTimeInput(e.target.value, setBulkScheduledTime)}
                              onBlur={(e) => normalizeTimeOnBlur(e.target.value, setBulkScheduledTime)}
                              placeholder="9:00am"
                              className="mt-1"
                            />
                          </div>
                          <div className="border-t pt-2">
                            <label className="text-xs text-muted-foreground">Or select a time</label>
                            <div className="grid grid-cols-3 gap-1 mt-1 max-h-48 overflow-y-auto">
                              {timeOptions.map((opt) => (
                                <Button
                                  key={opt.value}
                                  variant={bulkScheduledTime === opt.value ? "default" : "ghost"}
                                  size="sm"
                                  className="text-xs"
                                  onClick={() => setBulkScheduledTime(opt.value)}
                                >
                                  {opt.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </>
              )}
            </div>

            {bulkSendMode === "direct" && (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Subject</label>
                  <Input
                    value={bulkDirectSubject}
                    onChange={(e) => setBulkDirectSubject(e.target.value)}
                    placeholder="e.g. Quick intro, [First Name]"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Message</label>
                  <Textarea
                    value={bulkDirectBody}
                    onChange={(e) => setBulkDirectBody(e.target.value)}
                    placeholder="e.g. Hi [First Name], I wanted to reach out..."
                    rows={5}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use [First Name], [Last Name], [Firm Name], or [Custom Field] for placeholders.
                  </p>
                </div>
              </div>
            )}

            {((bulkSendMode === "sequence" && bulkSequenceId) || bulkSendMode === "direct") && bulkRequiredCustomFields.length > 0 && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm font-medium">Required custom fields:</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Include these in your CSV or fill them in below: {bulkRequiredCustomFields.join(", ")}
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleBulkImport}
                disabled={selectedValidCount === 0 || (bulkSendMode === "sequence" ? !bulkSequenceId : (!bulkDirectSubject.trim() || !bulkDirectBody.trim())) || bulkImportMutation.isPending}
              >
                <Upload className="mr-2 h-4 w-4" />
                {bulkSendImmediately ? `Import & Send to ${selectedValidCount} Customers` : `Import ${selectedValidCount} Customers`}
              </Button>
            </div>

            <div className="border rounded-lg max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={validCount > 0 && selectedValidCount === validCount}
                        onCheckedChange={toggleAllValid}
                      />
                    </TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Last Name</TableHead>
                    <TableHead>Firm Name</TableHead>
                    <TableHead>Email</TableHead>
                    {bulkRequiredCustomFields.map((field) => (
                      <TableHead key={field}>{field}</TableHead>
                    ))}
                    <TableHead className="w-12">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedCustomers.map((customer, index) => {
                    const rowValid = isBulkRowValid(customer, index);
                    const missingFields = getMissingCustomFields(customer, index);
                    const allErrors = [
                      ...customer.errors,
                      ...missingFields.map((f) => `Missing: ${f}`),
                    ];
                    const merged = getRowCustomFields(customer, index);
                    return (
                    <TableRow
                      key={index}
                      className={!rowValid ? "bg-destructive/10" : selectedRows.has(index) ? "bg-primary/5" : ""}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedRows.has(index)}
                          onCheckedChange={() => toggleRow(index)}
                          disabled={!rowValid}
                        />
                      </TableCell>
                      <TableCell>{customer.first_name || <span className="text-destructive">Missing</span>}</TableCell>
                      <TableCell>{customer.last_name || <span className="text-destructive">Missing</span>}</TableCell>
                      <TableCell>{customer.firm_name || <span className="text-destructive">Missing</span>}</TableCell>
                      <TableCell>{customer.email || <span className="text-destructive">Missing</span>}</TableCell>
                      {bulkRequiredCustomFields.map((field) => (
                        <TableCell key={field}>
                          <Input
                            value={merged[field] || ""}
                            onChange={(e) => updateBulkCustomField(index, field, e.target.value)}
                            placeholder={field}
                            className="h-8 text-xs min-w-[100px]"
                          />
                        </TableCell>
                      ))}
                      <TableCell>
                        {rowValid ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <div className="group relative">
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-popover border rounded-md p-2 text-xs shadow-lg z-10 whitespace-nowrap">
                              {allErrors.join(", ")}
                            </div>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add Single Customer
            </CardTitle>
            <CardDescription>Enter customer details manually</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">First Name *</label>
                  <Input
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    placeholder="John"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Last Name *</label>
                  <Input
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    placeholder="Doe"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Firm Name *</label>
                <Input
                  value={formData.firm_name}
                  onChange={(e) => setFormData({ ...formData, firm_name: e.target.value })}
                  placeholder="Acme Corp"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email Address *</label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@acmecorp.com"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Assign to Sequence *</label>
                <Select
                  value={formData.sequence_id}
                  onValueChange={(value) => setFormData({ ...formData, sequence_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a sequence" />
                  </SelectTrigger>
                  <SelectContent>
                    {sequences?.map((sequence) => (
                      <SelectItem key={sequence.id} value={sequence.id}>
                        {sequence.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {formData.sequence_id && (
                <div className="p-4 bg-muted/50 rounded-lg space-y-4">
                  <div>
                    <label className="text-sm font-medium">When to Send</label>
                    <Select 
                      value={sendImmediately ? "now" : "scheduled"} 
                      onValueChange={(v) => setSendImmediately(v === "now")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="now">Send Immediately</SelectItem>
                        <SelectItem value="scheduled">Schedule for Later</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {!sendImmediately && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium">Start Date</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !scheduledDate && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {scheduledDate ? format(scheduledDate, "PPP") : "Today"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={scheduledDate}
                              onSelect={setScheduledDate}
                              disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Start Time</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start text-left font-normal"
                            >
                              <Clock className="mr-2 h-4 w-4" />
                              {formatTimeDisplay(scheduledTime)}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-3" align="start">
                            <div className="space-y-3">
                              <div>
                                <label className="text-xs text-muted-foreground">Type a time (e.g., 9:30am, 14:00)</label>
                                <Input
                                  value={scheduledTime}
                                  onChange={(e) => handleTimeInput(e.target.value, setScheduledTime)}
                                  onBlur={(e) => normalizeTimeOnBlur(e.target.value, setScheduledTime)}
                                  placeholder="9:00am"
                                  className="mt-1"
                                />
                              </div>
                              <div className="border-t pt-2">
                                <label className="text-xs text-muted-foreground">Or select a time</label>
                                <div className="grid grid-cols-3 gap-1 mt-1 max-h-48 overflow-y-auto">
                                  {timeOptions.map((opt) => (
                                    <Button
                                      key={opt.value}
                                      variant={scheduledTime === opt.value ? "default" : "ghost"}
                                      size="sm"
                                      className="text-xs"
                                      onClick={() => setScheduledTime(opt.value)}
                                    >
                                      {opt.label}
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  )}
                  
                  <p className="text-xs text-muted-foreground">
                    {sendImmediately 
                      ? "The first email will be sent immediately. Follow-ups will be scheduled based on your sequence settings."
                      : "The first email will be sent at this time. Follow-ups will be scheduled based on your sequence settings."
                    }
                  </p>
                </div>
              )}
              
              {formData.sequence_id && requiredCustomFields.length > 0 && (
                <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                  <div>
                    <label className="text-sm font-medium">Custom Fields</label>
                    <p className="text-xs text-muted-foreground">These placeholders are used in this sequence's templates</p>
                  </div>
                  {requiredCustomFields.map((field) => (
                    <div key={field}>
                      <label className="text-xs text-muted-foreground">{field}</label>
                      <Input
                        value={customFieldValues[field] || ""}
                        onChange={(e) => setCustomFieldValues((prev) => ({ ...prev, [field]: e.target.value }))}
                        placeholder={`Enter ${field.toLowerCase()}...`}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="text-sm font-medium">Notes</label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Any additional notes about this customer..."
                  rows={3}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!formData.first_name || !formData.last_name || !formData.firm_name || !formData.email || !formData.sequence_id || createCustomerMutation.isPending || requiredCustomFields.some((f) => !customFieldValues[f]?.trim())}
              >
                <Plus className="mr-2 h-4 w-4" />
                {sendImmediately ? "Add Customer & Send Email" : "Add Customer & Schedule Email"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className={parsedCustomers.length === 0 ? "border-dashed" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Bulk Import
            </CardTitle>
            <CardDescription>Import multiple customers from a CSV file</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-center mb-4">
                Upload a CSV file with columns:<br />
                <code className="text-xs bg-muted px-2 py-1 rounded">
                  first_name, last_name, firm_name, email
                </code>
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="csv-upload"
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Select CSV File
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}