output "action_group_id" {
  description = "Action group of the owner's alerts."
  value       = azurerm_monitor_action_group.owner.id
}

output "workbook_id" {
  description = "The operations workbook (Azure portal > Monitor > Workbooks)."
  value       = azurerm_application_insights_workbook.operations.id
}
