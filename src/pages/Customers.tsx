import { useState, useRef } from "react";
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

interface ParsedCustomer {
  first_name: string;
  last_name: string;
  firm_name: string;
  email: string;
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
  
  // Scheduling state
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
  const [scheduledTime, setScheduledTime] = useState("09:00");
  
  // Bulk import state
  const [parsedCustomers, setParsedCustomers] = useState<ParsedCustomer[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkSequenceId, setBulkSequenceId] = useState("");
  const [bulkScheduledDate, setBulkScheduledDate] = useState<Date | undefined>(undefined);
  const [bulkScheduledTime, setBulkScheduledTime] = useState("09:00");
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sequences } = useQuery({
    queryKey: ["sequences"],
    queryFn: async () => {
      const { data, error } = await supabase.from("email_sequences").select("*");
      if (error) throw error;
      return data;
    },
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

  const getScheduledDateTime = (date: Date | undefined, time: string): Date => {
    const scheduledFor = date ? new Date(date) : new Date();
    const [hours, minutes] = time.split(":").map(Number);
    scheduledFor.setHours(hours || 9, minutes || 0, 0, 0);
    
    // If the scheduled time is in the past, use current time
    if (scheduledFor < new Date()) {
      return new Date();
    }
    return scheduledFor;
  };

  const createCustomerMutation = useMutation({
    mutationFn: async () => {
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
          notes: formData.notes || null,
          status: "new",
        })
        .select()
        .single();

      if (error) throw error;

      // Schedule the first email if a sequence is assigned
      if (firstStep && customer) {
        const scheduledFor = getScheduledDateTime(scheduledDate, scheduledTime);
        
        const { error: scheduleError } = await supabase.from("scheduled_sends").insert({
          customer_id: customer.id,
          step_id: firstStep.id,
          scheduled_for: scheduledFor.toISOString(),
        });
        if (scheduleError) console.error("Failed to schedule first email:", scheduleError);
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
      setScheduledDate(undefined);
      setScheduledTime("09:00");
      toast({ title: "Customer added successfully" });
    },
    onError: (error) => {
      toast({ title: "Error adding customer", description: error.message, variant: "destructive" });
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (customers: ParsedCustomer[]) => {
      const firstStep = steps?.find(
        (s) => s.sequence_id === bulkSequenceId && s.step_order === 0
      );

      const customersToInsert = customers.map((c) => ({
        first_name: c.first_name,
        last_name: c.last_name,
        firm_name: c.firm_name,
        email: c.email,
        sequence_id: bulkSequenceId || null,
        current_step_id: firstStep?.id || null,
        status: "new",
      }));

      const { data: insertedCustomers, error } = await supabase
        .from("customers")
        .insert(customersToInsert)
        .select();

      if (error) throw error;

      // Schedule first emails for all imported customers if a sequence is selected
      if (firstStep && insertedCustomers) {
        const scheduledFor = getScheduledDateTime(bulkScheduledDate, bulkScheduledTime);
        
        const scheduledSends = insertedCustomers.map((customer) => ({
          customer_id: customer.id,
          step_id: firstStep.id,
          scheduled_for: scheduledFor.toISOString(),
        }));

        const { error: scheduleError } = await supabase
          .from("scheduled_sends")
          .insert(scheduledSends);
          
        if (scheduleError) console.error("Failed to schedule emails:", scheduleError);
      }

      return insertedCustomers;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast({ title: `Successfully imported ${data?.length || 0} customers` });
      clearBulkImport();
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
    setBulkSequenceId("");
    setBulkScheduledDate(undefined);
    setBulkScheduledTime("09:00");
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

  const toggleAllValid = () => {
    const validIndices = parsedCustomers
      .map((c, i) => (c.isValid ? i : -1))
      .filter((i) => i >= 0);
    
    const allSelected = validIndices.every((i) => selectedRows.has(i));
    
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(validIndices));
    }
  };

  const handleBulkImport = () => {
    const customersToImport = parsedCustomers.filter((_, i) => selectedRows.has(i) && parsedCustomers[i].isValid);
    if (customersToImport.length === 0) {
      toast({ title: "No valid customers selected", variant: "destructive" });
      return;
    }
    bulkImportMutation.mutate(customersToImport);
  };

  const validCount = parsedCustomers.filter((c) => c.isValid).length;
  const selectedValidCount = parsedCustomers.filter((c, i) => selectedRows.has(i) && c.isValid).length;

  // Generate time options (every 30 minutes)
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

  // Format time for display
  const formatTimeDisplay = (time: string) => {
    try {
      const [hours, minutes] = time.split(":").map(Number);
      if (isNaN(hours) || isNaN(minutes)) return time;
      return format(new Date(2000, 0, 1, hours, minutes), "h:mm a");
    } catch {
      return time;
    }
  };

  // Validate and normalize time input
  const handleTimeInput = (value: string, setter: (time: string) => void) => {
    // Allow typing in progress
    setter(value);
  };

  const normalizeTimeOnBlur = (value: string, setter: (time: string) => void) => {
    // Try to parse various time formats
    let normalized = value.trim();
    
    // Handle formats like "9", "9:30", "9:30am", "9:30 am", "09:30", "930"
    const timeRegex = /^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i;
    const match = normalized.match(timeRegex);
    
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = match[2] ? parseInt(match[2], 10) : 0;
      const period = match[3]?.toLowerCase();
      
      // Convert to 24-hour format if am/pm specified
      if (period === "pm" && hours < 12) hours += 12;
      if (period === "am" && hours === 12) hours = 0;
      
      // Validate ranges
      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        const formattedTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
        setter(formattedTime);
        return;
      }
    }
    
    // If invalid, reset to default
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

      {/* Bulk Import Preview */}
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
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={clearBulkImport}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
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
            </div>

            <div className="flex justify-end">
              <Button 
                onClick={handleBulkImport} 
                disabled={selectedValidCount === 0 || !bulkSequenceId || bulkImportMutation.isPending}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import {selectedValidCount} Customers
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
                    <TableHead className="w-12">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedCustomers.map((customer, index) => (
                    <TableRow 
                      key={index} 
                      className={!customer.isValid ? "bg-destructive/10" : selectedRows.has(index) ? "bg-primary/5" : ""}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedRows.has(index)}
                          onCheckedChange={() => toggleRow(index)}
                          disabled={!customer.isValid}
                        />
                      </TableCell>
                      <TableCell>{customer.first_name || <span className="text-destructive">Missing</span>}</TableCell>
                      <TableCell>{customer.last_name || <span className="text-destructive">Missing</span>}</TableCell>
                      <TableCell>{customer.firm_name || <span className="text-destructive">Missing</span>}</TableCell>
                      <TableCell>{customer.email || <span className="text-destructive">Missing</span>}</TableCell>
                      <TableCell>
                        {customer.isValid ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <div className="group relative">
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-popover border rounded-md p-2 text-xs shadow-lg z-10 whitespace-nowrap">
                              {customer.errors.join(", ")}
                            </div>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Single Customer Form */}
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
              
              {/* Schedule section - only show when sequence is selected */}
              {formData.sequence_id && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
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
                  <p className="col-span-2 text-xs text-muted-foreground">
                    The first email will be sent at this time. Follow-ups will be scheduled based on your sequence settings.
                  </p>
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
                disabled={!formData.first_name || !formData.last_name || !formData.firm_name || !formData.email || !formData.sequence_id}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Customer & Schedule Emails
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Bulk Import */}
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

      {/* Quick Add Tips */}
      <Card>
        <CardHeader>
          <CardTitle>Placeholder Guide</CardTitle>
          <CardDescription>These placeholders will be replaced in your email templates</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 bg-muted rounded-lg">
              <code className="text-primary font-mono">[First Name]</code>
              <p className="text-sm text-muted-foreground mt-1">
                Replaced with the customer's first name
              </p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <code className="text-primary font-mono">[Firm Name]</code>
              <p className="text-sm text-muted-foreground mt-1">
                Replaced with the company/firm name
              </p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <code className="text-primary font-mono">[Custom Field]</code>
              <p className="text-sm text-muted-foreground mt-1">
                For additional personalization
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}