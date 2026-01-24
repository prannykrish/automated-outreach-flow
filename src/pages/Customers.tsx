import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Upload, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Customers() {
  const [formData, setFormData] = useState({
    first_name: "",
    firm_name: "",
    email: "",
    sequence_id: "",
    notes: "",
  });
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

  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      // Find the first step of the selected sequence
      const firstStep = steps?.find(
        (s) => s.sequence_id === formData.sequence_id && s.step_order === 0
      );

      const { data: customer, error } = await supabase
        .from("customers")
        .insert({
          first_name: formData.first_name,
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

      // If a sequence is assigned, schedule the first email
      if (firstStep && customer) {
        const { error: scheduleError } = await supabase.from("scheduled_sends").insert({
          customer_id: customer.id,
          step_id: firstStep.id,
          scheduled_for: new Date().toISOString(),
        });
        if (scheduleError) console.error("Failed to schedule first email:", scheduleError);
      }

      return customer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setFormData({
        first_name: "",
        firm_name: "",
        email: "",
        sequence_id: "",
        notes: "",
      });
      toast({ title: "Customer added successfully" });
    },
    onError: (error) => {
      toast({ title: "Error adding customer", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCustomerMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Add Customers</h1>
        <p className="text-muted-foreground">Add new customers to your email sequences</p>
      </div>

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
                  <label className="text-sm font-medium">Firm Name *</label>
                  <Input
                    value={formData.firm_name}
                    onChange={(e) => setFormData({ ...formData, firm_name: e.target.value })}
                    placeholder="Acme Corp"
                    required
                  />
                </div>
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
                <label className="text-sm font-medium">Assign to Sequence</label>
                <Select
                  value={formData.sequence_id}
                  onValueChange={(value) => setFormData({ ...formData, sequence_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a sequence (optional)" />
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
                disabled={!formData.first_name || !formData.firm_name || !formData.email}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Customer
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Bulk Import */}
        <Card className="border-dashed">
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
                  first_name, firm_name, email
                </code>
              </p>
              <Button variant="outline" disabled>
                <Upload className="mr-2 h-4 w-4" />
                Coming Soon
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
