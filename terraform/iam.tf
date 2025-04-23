
# Create a new Identity Center group for RootAccess
resource "aws_identitystore_group" "root_access_group" {
  identity_store_id = data.aws_ssoadmin_instances.sso.identity_store_ids[0]
  display_name      = "RootAccessAdmins" # Name of the new group
}

# You can now use this group for the RootAccess permission set
data "aws_ssoadmin_instances" "sso" {}

# Get all accounts in the organization
data "aws_organizations_accounts" "all" {}

# Create the permission set for RootAccess with sts:AssumeRoot
resource "aws_ssoadmin_permission_set" "root_access" {
  instance_arn     = data.aws_ssoadmin_instances.sso.arns[0]
  name             = "RootAccess"
  description      = "Provides centralized root-level access across all org accounts"
  session_duration = "PT12H"

  inline_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "sts:AssumeRole",
          "sts:AssumeRoot"
        ],
        Resource = "*"
      }
    ]
  })
}

# Attach AdministratorAccess policy to RootAccess permission set
resource "aws_ssoadmin_managed_policy_attachment" "root_admin_policy" {
  instance_arn       = data.aws_ssoadmin_instances.sso.arns[0]
  permission_set_arn = aws_ssoadmin_permission_set.root_access.arn
  managed_policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# Assign the RootAccess permission set to the new group across all accounts
resource "aws_ssoadmin_account_assignment" "root_access_assignments" {
  for_each = { for acc in data.aws_organizations_accounts.all.accounts : acc.id => acc }

  instance_arn       = data.aws_ssoadmin_instances.sso.arns[0]
  permission_set_arn = aws_ssoadmin_permission_set.root_access.arn
  principal_type     = "GROUP"
  principal_id       = aws_identitystore_group.root_access_group.id
  target_id          = each.key
  target_type        = "AWS_ACCOUNT"
}
