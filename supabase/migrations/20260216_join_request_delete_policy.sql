-- Allow users to delete their own pending join requests
CREATE POLICY "Users can delete own pending requests"
  ON public.join_requests FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');
