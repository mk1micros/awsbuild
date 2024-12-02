#Create VPC in es-west-2
resource "aws_vpc" "vpc_master" {
  provider             = aws.region-master
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = {
    "key" = "value",
    Name  = "Rust master"
  }

}



#Create IGW in eu-west-2
resource "aws_internet_gateway" "igw-london" {
  provider = aws.region-master
  vpc_id   = aws_vpc.vpc_master.id
  tags = {
    Name = "Master VPC IGW"
  }
}

#Create VPC endpoint for ec2 connection
resource "aws_ec2_instance_connect_endpoint" "master_vpc_endpoint" {
  subnet_id = aws_subnet.subnet_2.id

  tags = merge(local.tags, 
    {Name = "EC connect master"}
  )
}



#Get all available AZ's in VPC for master region
data "aws_availability_zones" "azs" {
  provider = aws.region-master
  state    = "available"
}

#Create subnet # 1 in eu-west-1
resource "aws_subnet" "subnet_1" {
  provider          = aws.region-master
  availability_zone = element(data.aws_availability_zones.azs.names, 0)
  vpc_id            = aws_vpc.vpc_master.id
  cidr_block        = "10.0.1.0/24"
}


#Create subnet #2  in eu-west-1
resource "aws_subnet" "subnet_2" {
  provider          = aws.region-master
  vpc_id            = aws_vpc.vpc_master.id
  availability_zone = element(data.aws_availability_zones.azs.names, 1)
  cidr_block        = "10.0.2.0/24"
}





#Create route table in eu-west-2
resource "aws_route_table" "internet_route" {
  provider = aws.region-master
  vpc_id   = aws_vpc.vpc_master.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw-london.id
  }
  lifecycle {
    ignore_changes = all
  }
  tags = {
    Name = "Worker-Region-RT"
  }
}

#Overwrite default route table of VPC(Master) with our route table entries
resource "aws_main_route_table_association" "set-master-default-rt-assoc" {
  provider       = aws.region-master
  vpc_id         = aws_vpc.vpc_master.id
  route_table_id = aws_route_table.internet_route.id
}


resource "aws_kms_key" "flowlog_kms_key" {
  description             = "VPC Flow Logs Encryption Key"
  key_usage = "ENCRYPT_DECRYPT"
  enable_key_rotation     = true
}

resource "aws_kms_key_policy" "flowlog_kms_key_policy" {
  key_id = aws_kms_key.flowlog_kms_key.id
  policy = jsonencode({
    Id = "flowlog policy"
    Statement = [
      {
       Sid      = "Enable IAM User Permissions"
        Effect   = "Allow"
        Principal = {
          AWS = "*"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
      
        Sid = "Allow CloudWatch Logs Use of the Key"
        Effect = "Allow"
        Principal = {
          Service = "logs.${var.region-master}.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = "*"
      },
    ]
    Version = "2012-10-17"
  })
}

resource "aws_flow_log" "london_flowlogs" {
  log_destination_type = "cloud-watch-logs"
  log_destination       = aws_cloudwatch_log_group.london_flow_log_group.arn
  iam_role_arn = aws_iam_role.flowlog_iam_role.arn
  traffic_type          = "ALL"
  max_aggregation_interval = 60
  vpc_id = aws_vpc.vpc_master.id

  
}

resource "aws_cloudwatch_log_group" "london_flow_log_group" {
  depends_on = [ aws_kms_key.flowlog_kms_key ]
  name = "london-flow-log-group"
  kms_key_id = aws_kms_key.flowlog_kms_key.arn
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "flowlog_iam_role" {
  name               = "flowlog_iam_role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

data "aws_iam_policy_document" "flowlog_iam_policy_doc" {
  statement {
    effect = "Allow"

    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
    ]

    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "flowlog_iam_policy" {
  name   = "flowlog_iam_policy"
  role   = aws_iam_role.flowlog_iam_role.id
  policy = data.aws_iam_policy_document.flowlog_iam_policy_doc.json
}