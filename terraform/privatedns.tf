module "privatedns" {
    source = "./modules/private_dns"
    dns_zone = "test"
    vpc_id = aws_vpc.vpc_master.id
    vpc_id2 = aws_vpc.vpc_ireland.id
  
}