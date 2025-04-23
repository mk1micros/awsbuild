
# Get the SSO instance
data "aws_ssoadmin_instances" "sso" {}

# Your Identity Center group (change to your actual group name)
data "aws_identitystore_group" "admins" {
  identity_store_id = data.aws_ssoadmin_instances.sso.identity_store_ids[0]
  display_name      = "CloudAdmins" # 👈 Change if needed
}

# Permission set with AdministratorAccess + sts:AssumeRoot
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
          "sts:AssumeRoot" # 👈 Enables centralized root access
        ],
        Resource = "*"
      }
    ]
  })
}

# Attach AWS-managed AdministratorAccess policy as well
resource "aws_ssoadmin_managed_policy_attachment" "root_admin_policy" {
  instance_arn       = data.aws_ssoadmin_instances.sso.arns[0]
  permission_set_arn = aws_ssoadmin_permission_set.root_access.arn
  managed_policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# Get all accounts in the org
data "aws_organizations_accounts" "all" {}

# Assign the permission set to your group for each account
resource "aws_ssoadmin_account_assignment" "assignments" {
  for_each = { for acc in data.aws_organizations_accounts.all.accounts : acc.id => acc }

  instance_arn       = data.aws_ssoadmin_instances.sso.arns[0]
  permission_set_arn = aws_ssoadmin_permission_set.root_access.arn
  principal_type     = "GROUP"
  principal_id       = data.aws_identitystore_group.admins.id
  target_id          = each.key
  target_type        = "AWS_ACCOUNT"
}
